import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getCacheDir } from "../data-dir";
import { DhanApiError, dhanRateLimitedPost } from "./config";
import type { IndexInstrument } from "./instruments";

export type RollingBar = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  spot: number;
  strike: number;
  iv: number;
  oi: number;
  volume: number;
};

export type RollingSeriesKey = {
  strikeKey: string;
  right: "CALL" | "PUT";
};

type RollingPayload = {
  status?: string;
  errorMessage?: string;
  message?: string;
  remarks?: string;
  data?: {
    ce?: Record<string, number[] | null> | null;
    pe?: Record<string, number[] | null> | null;
  };
};

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function fnoSegment(instrument: IndexInstrument) {
  return instrument.id === "SENSEX" ? "BSE_FNO" : "NSE_FNO";
}

function cachePath(
  instrument: IndexInstrument,
  strikeKey: string,
  right: string,
  from: string,
  to: string,
) {
  const safe = `${instrument.id}_${strikeKey}_${right}_${from}_${to}`.replace(
    /[^a-zA-Z0-9_+-]/g,
    "_",
  );
  return path.join(getCacheDir(), `${safe}.json`);
}

async function readCache(file: string): Promise<RollingBar[] | null> {
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw) as RollingBar[];
  } catch {
    return null;
  }
}

async function writeCache(file: string, bars: RollingBar[]) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(bars), "utf8");
}

function mapSide(
  side: Record<string, number[] | null> | null | undefined,
): RollingBar[] {
  if (!side) return [];
  const timestamps = side.timestamp ?? [];
  const closes = side.close ?? [];
  const opens = side.open ?? [];
  const highs = side.high ?? [];
  const lows = side.low ?? [];
  const spots = side.spot ?? [];
  const strikes = side.strike ?? [];
  const ivs = side.iv ?? [];
  const ois = side.oi ?? [];
  const volumes = side.volume ?? [];

  const bars: RollingBar[] = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const timestamp = timestamps[i];
    const close = closes[i];
    if (!timestamp || close === undefined || close === null) continue;
    bars.push({
      timestamp,
      open: opens[i] ?? close,
      high: highs[i] ?? close,
      low: lows[i] ?? close,
      close,
      spot: spots[i] ?? 0,
      strike: strikes[i] ?? 0,
      iv: ivs[i] ?? 0,
      oi: ois[i] ?? 0,
      volume: volumes[i] ?? 0,
    });
  }
  return bars;
}

async function fetchRollingChunk(
  instrument: IndexInstrument,
  strikeKey: string,
  right: "CALL" | "PUT",
  fromDate: string,
  toDate: string,
): Promise<RollingBar[]> {
  const file = cachePath(instrument, strikeKey, right, fromDate, toDate);
  const cached = await readCache(file);
  if (cached) return cached;

  const { status, payload } = await dhanRateLimitedPost<RollingPayload>(
    "/v2/charts/rollingoption",
    {
      exchangeSegment: fnoSegment(instrument),
      interval: 60,
      securityId: instrument.securityId,
      instrument: "OPTIDX",
      expiryFlag: "WEEK",
      expiryCode: 1,
      strike: strikeKey,
      drvOptionType: right,
      requiredData: [
        "open",
        "high",
        "low",
        "close",
        "volume",
        "iv",
        "oi",
        "spot",
        "strike",
      ],
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
        `Rolling option fetch failed (${status}) for ${strikeKey} ${right}`,
      status,
    );
  }

  const bars =
    right === "CALL" ? mapSide(payload.data?.ce ?? undefined) : mapSide(payload.data?.pe ?? undefined);

  await writeCache(file, bars);
  return bars;
}

/** Merge bars by timestamp (later chunk overwrites). */
function mergeBars(chunks: RollingBar[][]) {
  const byTs = new Map<number, RollingBar>();
  for (const chunk of chunks) {
    for (const bar of chunk) byTs.set(bar.timestamp, bar);
  }
  return [...byTs.values()].sort((a, b) => a.timestamp - b.timestamp);
}

export async function fetchRollingSeries(
  instrument: IndexInstrument,
  strikeKey: string,
  right: "CALL" | "PUT",
  from: Date,
  to: Date,
): Promise<RollingBar[]> {
  const chunks: RollingBar[][] = [];
  let cursor = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );
  const end = new Date(
    Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()),
  );

  while (cursor < end) {
    const chunkEnd = addDays(cursor, 30);
    const toDate = chunkEnd < end ? chunkEnd : end;
    const bars = await fetchRollingChunk(
      instrument,
      strikeKey,
      right,
      formatDate(cursor),
      formatDate(toDate),
    );
    chunks.push(bars);
    cursor = toDate;
  }

  return mergeBars(chunks);
}

export async function fetchRollingBundle(
  instrument: IndexInstrument,
  strikeKeys: string[],
  rights: Array<"CALL" | "PUT">,
  from: Date,
  to: Date,
) {
  const series: Record<string, RollingBar[]> = {};
  for (const strikeKey of strikeKeys) {
    for (const right of rights) {
      const key = `${strikeKey}:${right === "CALL" ? "CE" : "PE"}`;
      series[key] = await fetchRollingSeries(
        instrument,
        strikeKey,
        right,
        from,
        to,
      );
    }
  }
  return series;
}

/** Collapse hourly bars to one bar per IST calendar day (last bar of day). */
export function toDailyBars(bars: RollingBar[]) {
  const byDay = new Map<string, RollingBar>();
  for (const bar of bars) {
    const day = new Date(bar.timestamp * 1000).toLocaleDateString("en-CA", {
      timeZone: "Asia/Kolkata",
    });
    byDay.set(day, bar);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, bar]) => ({ day, bar }));
}
