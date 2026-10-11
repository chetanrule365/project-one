import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getCacheDir } from "../data-dir";
import { blobGetJson, blobSetJson } from "../store/blob";
import { isMongoConfigured } from "../mongo";
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
  const name = path.basename(file);
  try {
    const raw = await readFile(file, "utf8");
    if (isMongoConfigured()) void blobSetJson(`option-cache/${name}`, raw, { once: true });
    return JSON.parse(raw) as RollingBar[];
  } catch {
    /* try MongoDB */
  }
  if (!isMongoConfigured()) return null;
  const remote = await blobGetJson(`option-cache/${name}`);
  if (!remote) return null;
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, remote, "utf8");
  } catch {
    /* disk cache is optional */
  }
  try {
    return JSON.parse(remote) as RollingBar[];
  } catch {
    return null;
  }
}

async function writeCache(file: string, bars: RollingBar[]) {
  const json = JSON.stringify(bars);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, json, "utf8");
  if (isMongoConfigured()) {
    void blobSetJson(`option-cache/${path.basename(file)}`, json, { once: true });
  }
}

function barDayUtc(bar: RollingBar) {
  return new Date(bar.timestamp * 1000).toISOString().slice(0, 10);
}

/** Exact file, or bars from older lookback files that already cover this window. */
async function readCacheWindow(
  instrument: IndexInstrument,
  strikeKey: string,
  right: string,
  fromDate: string,
  toDate: string,
): Promise<RollingBar[] | null> {
  const exact = await readCache(
    cachePath(instrument, strikeKey, right, fromDate, toDate),
  );
  if (exact) return exact;

  let names: string[] = [];
  try {
    names = await readdir(getCacheDir());
  } catch {
    return null;
  }
  const prefix = `${instrument.id}_${strikeKey}_${right}_`;
  const byTs = new Map<number, RollingBar>();
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith(".json")) continue;
    const bars = await readCache(path.join(getCacheDir(), name));
    if (!bars) continue;
    for (const bar of bars) {
      const day = barDayUtc(bar);
      if (day >= fromDate && day < toDate) byTs.set(bar.timestamp, bar);
    }
  }
  if (byTs.size === 0) return null;
  return [...byTs.values()].sort((a, b) => a.timestamp - b.timestamp);
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

export type RollingProgress = {
  done: number;
  total: number;
  cached: number;
  fetched: number;
  label: string;
};

function utcDay(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/** Count backward from `to` so 3/6/12 month lookbacks share the same cache files. */
function rollingWindows(from: Date, to: Date) {
  const start = utcDay(from);
  let cursor = utcDay(to);
  const windows: Array<{ fromDate: string; toDate: string }> = [];
  while (cursor > start) {
    const chunkStart = addDays(cursor, -30);
    const fromDate = chunkStart > start ? chunkStart : start;
    windows.unshift({
      fromDate: formatDate(fromDate),
      toDate: formatDate(cursor),
    });
    cursor = fromDate;
  }
  return windows;
}

function countSeriesChunks(from: Date, to: Date) {
  return rollingWindows(from, to).length;
}

export function countRollingChunks(
  strikeKeys: string[],
  rights: Array<"CALL" | "PUT">,
  from: Date,
  to: Date,
) {
  return strikeKeys.length * rights.length * countSeriesChunks(from, to);
}

async function fetchRollingChunk(
  instrument: IndexInstrument,
  strikeKey: string,
  right: "CALL" | "PUT",
  fromDate: string,
  toDate: string,
): Promise<{ bars: RollingBar[]; cached: boolean }> {
  const file = cachePath(instrument, strikeKey, right, fromDate, toDate);
  const cached = await readCacheWindow(
    instrument,
    strikeKey,
    right,
    fromDate,
    toDate,
  );
  if (cached) {
    try {
      await writeCache(file, cached);
    } catch {
      /* neighbor bars are enough */
    }
    return { bars: cached, cached: true };
  }

  const { status, payload } = await dhanRateLimitedPost<RollingPayload>(
    "/v2/charts/rollingoption",
    {
      exchangeSegment: fnoSegment(instrument),
      interval: 60,
      securityId: String(instrument.securityId),
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
  return { bars, cached: false };
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
  onChunk?: (info: { cached: boolean; label: string }) => void,
): Promise<RollingBar[]> {
  const chunks: RollingBar[][] = [];
  for (const window of rollingWindows(from, to)) {
    const { bars, cached } = await fetchRollingChunk(
      instrument,
      strikeKey,
      right,
      window.fromDate,
      window.toDate,
    );
    onChunk?.({
      cached,
      label: `${instrument.id} ${strikeKey} ${right} ${window.fromDate}→${window.toDate}`,
    });
    chunks.push(bars);
  }

  return mergeBars(chunks);
}

export async function fetchRollingBundle(
  instrument: IndexInstrument,
  strikeKeys: string[],
  rights: Array<"CALL" | "PUT">,
  from: Date,
  to: Date,
  onProgress?: (progress: RollingProgress) => void,
) {
  const total = countRollingChunks(strikeKeys, rights, from, to);
  let done = 0;
  let cached = 0;
  let fetched = 0;
  onProgress?.({
    done: 0,
    total,
    cached: 0,
    fetched: 0,
    label: `Reading cache 0/${total}`,
  });
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
        (info) => {
          done += 1;
          if (info.cached) cached += 1;
          else fetched += 1;
          onProgress?.({ done, total, cached, fetched, label: info.label });
        },
      );
    }
  }
  return series;
}

/** Upload local rolling-option files to MongoDB in the background. */
export function startOptionCacheSync() {
  if (!isMongoConfigured()) return;
  void (async () => {
    let names: string[] = [];
    try {
      names = await readdir(getCacheDir());
    } catch {
      return;
    }
    let count = 0;
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      try {
        const raw = await readFile(path.join(getCacheDir(), name), "utf8");
        await blobSetJson(`option-cache/${name}`, raw, { once: true });
        count += 1;
        if (count % 8 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
      } catch {
        /* skip unreadable chunks */
      }
    }
    if (count > 0) console.log(`[mongo] option-cache sync queued ${count} files`);
  })();
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istDay(timestampSec: number) {
  const ist = new Date(timestampSec * 1000 + IST_OFFSET_MS);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}-${String(ist.getUTCDate()).padStart(2, "0")}`;
}

/** Collapse hourly bars to one bar per IST calendar day (last bar of day). */
export function toDailyBars(bars: RollingBar[]) {
  const byDay = new Map<string, RollingBar>();
  for (const bar of bars) {
    byDay.set(istDay(bar.timestamp), bar);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, bar]) => ({ day, bar }));
}
