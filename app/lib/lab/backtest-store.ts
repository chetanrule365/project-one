import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getDataDir } from "../data-dir";
import { computeMetrics, type BacktestResult } from "./backtest";

export type SavedBacktest = BacktestResult & {
  id: number;
  savedAt: string;
};

type Store = {
  nextId: number;
  runs: SavedBacktest[];
};

const MAX_RUNS = 25;

function storePath() {
  mkdirSync(getDataDir(), { recursive: true });
  return path.join(getDataDir(), "backtests.json");
}

let cache: Store | null = null;

function empty(): Store {
  return { nextId: 1, runs: [] };
}

function load(): Store {
  const file = storePath();
  if (!existsSync(file)) {
    cache = empty();
    return cache;
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Store;
    cache = {
      nextId: Number(parsed.nextId) || 1,
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
    };
    return cache;
  } catch (error) {
    console.error(`[backtest-store] failed to read ${file}`, error);
    return cache ?? empty();
  }
}

function persist(state: Store) {
  const file = storePath();
  const payload = JSON.stringify(state, null, 2);
  let lastError: unknown;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      writeFileSync(file, payload);
      cache = state;
      return;
    } catch (error) {
      lastError = error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY") throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
    }
  }
  throw lastError;
}

export function saveBacktest(result: BacktestResult): SavedBacktest {
  const state = load();
  const row: SavedBacktest = {
    ...result,
    id: state.nextId++,
    savedAt: new Date().toISOString(),
  };
  state.runs.unshift(row);
  if (state.runs.length > MAX_RUNS) state.runs.length = MAX_RUNS;
  persist(state);
  return row;
}

export function listBacktests(): Array<{
  id: number;
  savedAt: string;
  instrumentId: string;
  strategyIds: string[];
  from: string;
  to: string;
  trades: number;
  winRate: number;
  totalPnlInr: number;
  brokerageInr: number;
  totalPnlAfterBrokerageInr: number;
}> {
  return load().runs.map((run) => {
    const metrics = computeMetrics(run.trades);
    return {
      id: run.id,
      savedAt: run.savedAt,
      instrumentId: run.instrumentId,
      strategyIds: run.strategyIds,
      from: run.from,
      to: run.to,
      trades: metrics.trades,
      winRate: metrics.winRate,
      totalPnlInr: metrics.totalPnlInr,
      brokerageInr: metrics.brokerageInr,
      totalPnlAfterBrokerageInr: metrics.totalPnlAfterBrokerageInr,
    };
  });
}

export function getBacktest(id: number): SavedBacktest | null {
  const run = load().runs.find((row) => row.id === id);
  if (!run) return null;
  return { ...run, metrics: computeMetrics(run.trades) };
}
