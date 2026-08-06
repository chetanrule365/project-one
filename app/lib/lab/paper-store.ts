import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { getDataDir } from "../data-dir";

export type PaperRun = {
  id: number;
  instrument_id: string;
  strategy_id: string;
  width_steps: number;
  status: "active" | "stopped";
  created_at: string;
  updated_at: string;
};

export type PaperTrade = {
  id: number;
  run_id: number;
  strategy_id: string;
  status: "open" | "closed";
  short_strike: number;
  long_strike: number;
  short_side: string;
  long_side: string;
  credit: number;
  width: number;
  spot_entry: number;
  spot_exit: number | null;
  pnl_points: number | null;
  pnl_inr: number | null;
  entry_at: string;
  expiry_at: string;
  exit_at: string | null;
};

type PaperState = {
  nextRunId: number;
  nextTradeId: number;
  runs: PaperRun[];
  trades: PaperTrade[];
};

const EMPTY: PaperState = {
  nextRunId: 1,
  nextTradeId: 1,
  runs: [],
  trades: [],
};

function storePath() {
  mkdirSync(getDataDir(), { recursive: true });
  return path.join(getDataDir(), "paper.json");
}

let cache: PaperState | null = null;

function load(): PaperState {
  if (cache) return cache;
  const file = storePath();
  if (!existsSync(file)) {
    cache = structuredClone(EMPTY);
    return cache;
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as PaperState;
    cache = {
      nextRunId: Number(parsed.nextRunId) || 1,
      nextTradeId: Number(parsed.nextTradeId) || 1,
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
      trades: Array.isArray(parsed.trades) ? parsed.trades : [],
    };
  } catch (error) {
    console.error(`[paper-store] failed to read ${file}, starting empty`, error);
    cache = structuredClone(EMPTY);
  }
  return cache;
}

function save(state: PaperState) {
  const file = storePath();
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, file);
  cache = state;
}

export function listPaperRuns() {
  return [...load().runs].sort((a, b) => b.id - a.id).slice(0, 20);
}

export function listActiveRuns() {
  return load()
    .runs.filter((run) => run.status === "active")
    .sort((a, b) => a.instrument_id.localeCompare(b.instrument_id));
}

/** @deprecated Prefer listActiveRuns — kept for single-run call sites. */
export function getActiveRun(instrumentId?: string) {
  const active = listActiveRuns();
  if (instrumentId) {
    return active.find((run) => run.instrument_id === instrumentId);
  }
  return active[0];
}

export function startPaperRun(input: {
  instrumentId: string;
  strategyId: string;
  widthSteps: number;
}) {
  const state = load();
  const now = new Date().toISOString();
  // One active run per index — restarting Nifty does not stop Bank Nifty.
  for (const run of state.runs) {
    if (run.status === "active" && run.instrument_id === input.instrumentId) {
      run.status = "stopped";
      run.updated_at = now;
    }
  }
  const run: PaperRun = {
    id: state.nextRunId++,
    instrument_id: input.instrumentId,
    strategy_id: input.strategyId,
    width_steps: input.widthSteps,
    status: "active",
    created_at: now,
    updated_at: now,
  };
  state.runs.push(run);
  save(state);
  return run;
}

export function stopPaperRun(runId: number) {
  const state = load();
  const run = state.runs.find((item) => item.id === runId);
  if (!run) return;
  run.status = "stopped";
  run.updated_at = new Date().toISOString();
  save(state);
}

export function listTradesForRun(runId: number) {
  return load()
    .trades.filter((trade) => trade.run_id === runId)
    .sort((a, b) => b.id - a.id);
}

export function getOpenTrade(runId: number) {
  return load()
    .trades.filter((trade) => trade.run_id === runId && trade.status === "open")
    .sort((a, b) => b.id - a.id)[0];
}

export function insertOpenTrade(
  trade: Omit<
    PaperTrade,
    "id" | "spot_exit" | "pnl_points" | "pnl_inr" | "exit_at" | "status"
  >,
) {
  const state = load();
  const row: PaperTrade = {
    id: state.nextTradeId++,
    ...trade,
    status: "open",
    spot_exit: null,
    pnl_points: null,
    pnl_inr: null,
    exit_at: null,
  };
  state.trades.push(row);
  save(state);
  return row;
}

export function closeTrade(
  tradeId: number,
  input: { spotExit: number; pnlPoints: number; pnlInr: number },
) {
  const state = load();
  const trade = state.trades.find((item) => item.id === tradeId);
  if (!trade) return;
  trade.status = "closed";
  trade.spot_exit = input.spotExit;
  trade.pnl_points = input.pnlPoints;
  trade.pnl_inr = input.pnlInr;
  trade.exit_at = new Date().toISOString();
  save(state);
}
