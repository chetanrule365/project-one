import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { getCacheDir } from "../data-dir";
import { blobGetJson, blobSetJson } from "../store/blob";
import { isMongoConfigured } from "../mongo";
import { todayIst } from "../strategies/expiry-day";
import type { SweepBar } from "../strategies/liquidity-sweep";
import { DhanApiError, dhanRateLimitedPost } from "./config";
import type { IndexInstrument } from "./instruments";

type SeriesPayload = {
  status?: string;
  errorMessage?: string;
  message?: string;
  remarks?: string;
  open?: number[];
  high?: number[];
  low?: number[];
  close?: number[];
  volume?: number[];
  timestamp?: number[];
  spot?: number[];
  data?: {
    ce?: Record<string, number[] | null> | null;
    pe?: Record<string, number[] | null> | null;
  };
};

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const LIVE_MAX_AGE_MS = 60_000;

type Candle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  spot: number;
};

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function utcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function windows(from: Date, to: Date, spanDays: number) {
  const start = utcDay(from);
  let cursor = utcDay(to);
  if (cursor <= start) {
    const day = formatDate(start);
    return [{ fromDate: day, toDate: day }];
  }
  const chunks: Array<{ fromDate: string; toDate: string }> = [];
  while (cursor > start) {
    const chunkStart = addDays(cursor, -spanDays);
    const fromDate = chunkStart > start ? chunkStart : start;
    chunks.unshift({ fromDate: formatDate(fromDate), toDate: formatDate(cursor) });
    cursor = fromDate;
  }
  return chunks;
}

function cacheFile(name: string) {
  return path.join(getCacheDir(), name);
}

async function readJson(file: string, maxAgeMs: number): Promise<string | null> {
  try {
    const info = await stat(file);
    if (maxAgeMs < Infinity && Date.now() - info.mtimeMs > maxAgeMs) return null;
    return await readFile(file, "utf8");
  } catch {
    /* disk miss */
  }
  if (!isMongoConfigured() || maxAgeMs < Infinity) return null;
  const remote = await blobGetJson(`option-cache/${path.basename(file)}`);
  if (!remote) return null;
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, remote, "utf8");
  } catch {
    /* disk cache is optional */
  }
  return remote;
}

async function writeJson(file: string, json: string) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, json, "utf8");
  if (isMongoConfigured()) {
    void blobSetJson(`option-cache/${path.basename(file)}`, json, { once: true });
  }
}

function istStamp(timestampSec: number) {
  const ist = new Date(timestampSec * 1000 + IST_OFFSET_MS);
  const day = `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}-${String(ist.getUTCDate()).padStart(2, "0")}`;
  const minute = Math.floor(ist.getUTCMinutes() / 5) * 5;
  return {
    day,
    hour: ist.getUTCHours(),
    minute,
    key: `${day}|${ist.getUTCHours()}|${minute}`,
  };
}

function candlesFromArrays(payload: SeriesPayload, side?: Record<string, number[] | null> | null): Candle[] {
  const source = side ?? payload;
  const timestamps = source.timestamp ?? [];
  const opens = source.open ?? [];
  const highs = source.high ?? [];
  const lows = source.low ?? [];
  const closes = source.close ?? [];
  const volumes = source.volume ?? [];
  const spots = "spot" in source ? source.spot ?? [] : [];
  const candles: Candle[] = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const timestamp = timestamps[i];
    const close = closes[i];
    if (!timestamp || close === undefined || close === null) continue;
    candles.push({
      timestamp,
      open: opens[i] ?? close,
      high: highs[i] ?? close,
      low: lows[i] ?? close,
      close,
      volume: volumes[i] ?? 0,
      spot: spots[i] ?? 0,
    });
  }
  return candles;
}

async function fetchIndexChunk(instrument: IndexInstrument, fromDate: string, toDate: string) {
  const name = `i5_${instrument.id}_INDEX_${fromDate}_${toDate}.json`;
  const file = cacheFile(name);
  const historical = toDate < todayIst();
  const cached = await readJson(file, historical ? Infinity : LIVE_MAX_AGE_MS);
  if (cached) {
    try {
      return JSON.parse(cached) as Candle[];
    } catch {
      /* refetch */
    }
  }
  const { status, payload } = await dhanRateLimitedPost<SeriesPayload>(
    "/v2/charts/intraday",
    {
      securityId: String(instrument.securityId),
      exchangeSegment: "IDX_I",
      instrument: "INDEX",
      interval: "5",
      oi: false,
      fromDate: `${fromDate} 09:00:00`,
      toDate: `${toDate} 15:30:00`,
    },
    "rollingoption",
  );
  if (status >= 400 || payload.status === "failed") {
    throw new DhanApiError(
      payload.errorMessage || payload.message || payload.remarks || `5-minute index fetch failed (${status})`,
      status,
    );
  }
  const candles = candlesFromArrays(payload);
  if (candles.length > 0) await writeJson(file, JSON.stringify(candles));
  return candles;
}

async function fetchAtmChunk(
  instrument: IndexInstrument,
  right: "CALL" | "PUT",
  fromDate: string,
  toDate: string,
) {
  const name = `i5_${instrument.id}_ATM_${right}_${fromDate}_${toDate}.json`;
  const file = cacheFile(name);
  const historical = toDate < todayIst();
  const cached = await readJson(file, historical ? Infinity : LIVE_MAX_AGE_MS);
  if (cached) {
    try {
      return JSON.parse(cached) as Candle[];
    } catch {
      /* refetch */
    }
  }
  const { status, payload } = await dhanRateLimitedPost<SeriesPayload>(
    "/v2/charts/rollingoption",
    {
      exchangeSegment: instrument.id === "SENSEX" ? "BSE_FNO" : "NSE_FNO",
      interval: 5,
      securityId: String(instrument.securityId),
      instrument: "OPTIDX",
      expiryFlag: "WEEK",
      expiryCode: 1,
      strike: "ATM",
      drvOptionType: right,
      requiredData: ["open", "high", "low", "close", "volume", "spot"],
      fromDate,
      toDate,
    },
    "rollingoption",
  );
  if (status >= 400 || payload.status === "failed") {
    throw new DhanApiError(
      payload.errorMessage ||
        payload.message ||
        payload.remarks ||
        `5-minute ATM ${right} fetch failed (${status})`,
      status,
    );
  }
  const side = right === "CALL" ? payload.data?.ce : payload.data?.pe;
  const candles = candlesFromArrays(payload, side ?? undefined);
  if (candles.length > 0) await writeJson(file, JSON.stringify(candles));
  return candles;
}

function mergeCandles(chunks: Candle[][]) {
  const byTs = new Map<number, Candle>();
  for (const chunk of chunks) {
    for (const candle of chunk) byTs.set(candle.timestamp, candle);
  }
  return [...byTs.values()].sort((a, b) => a.timestamp - b.timestamp);
}

/** Index 5-minute OHLC plus ATM call+put volume. Cached apart from the hourly option files. */
export async function loadSweepBars(
  instrument: IndexInstrument,
  from: Date,
  to: Date,
): Promise<SweepBar[]> {
  const indexChunks: Candle[][] = [];
  for (const window of windows(from, to, 7)) {
    indexChunks.push(await fetchIndexChunk(instrument, window.fromDate, window.toDate));
  }
  const volumeByKey = new Map<string, number>();
  const spotByKey = new Map<string, number>();
  for (const right of ["CALL", "PUT"] as const) {
    const chunks: Candle[][] = [];
    for (const window of windows(from, to, 10)) {
      chunks.push(await fetchAtmChunk(instrument, right, window.fromDate, window.toDate));
    }
    for (const candle of mergeCandles(chunks)) {
      const stamp = istStamp(candle.timestamp);
      volumeByKey.set(stamp.key, (volumeByKey.get(stamp.key) ?? 0) + candle.volume);
      if (candle.spot) spotByKey.set(stamp.key, candle.spot);
    }
  }

  const index = mergeCandles(indexChunks);
  if (index.length === 0) {
    const bars: SweepBar[] = [];
    for (const [key, volume] of volumeByKey) {
      const spot = spotByKey.get(key) ?? 0;
      if (!spot) continue;
      const [day, hour, minute] = key.split("|");
      bars.push({
        day,
        hour: Number(hour),
        minute: Number(minute),
        open: spot,
        high: spot,
        low: spot,
        close: spot,
        volume,
      });
    }
    return bars.sort((a, b) =>
      a.day === b.day ? a.hour * 60 + a.minute - (b.hour * 60 + b.minute) : a.day.localeCompare(b.day),
    );
  }

  return index.map((candle) => {
    const stamp = istStamp(candle.timestamp);
    const spot = candle.close || spotByKey.get(stamp.key) || 0;
    return {
      day: stamp.day,
      hour: stamp.hour,
      minute: stamp.minute,
      open: candle.open || spot,
      high: candle.high || spot,
      low: candle.low || spot,
      close: candle.close || spot,
      volume: volumeByKey.get(stamp.key) ?? candle.volume,
    };
  });
}

const liveCache = new Map<string, { at: number; bars: SweepBar[] }>();

/** Today's session, reused for 60 seconds across playbook and paper polls. */
export async function loadTodaySweepBars(instrument: IndexInstrument): Promise<SweepBar[]> {
  const hit = liveCache.get(instrument.id);
  if (hit && Date.now() - hit.at < LIVE_MAX_AGE_MS) return hit.bars;
  const today = todayIst();
  const start = new Date(`${today}T09:00:00+05:30`);
  const end = new Date(`${today}T16:00:00+05:30`);
  const bars = (await loadSweepBars(instrument, start, end)).filter((bar) => bar.day === today);
  liveCache.set(instrument.id, { at: Date.now(), bars });
  return bars;
}
