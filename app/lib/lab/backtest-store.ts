import { createJsonStore } from "../store/json-store";
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

const store = createJsonStore<Store>({
  key: "backtests",
  fileName: "backtests.json",
  empty: () => ({ nextId: 1, runs: [] }),
  remote: "blob",
});

export async function hydrateBacktestStore() {
  await store.hydrate();
}

function load(): Store {
  const state = store.load();
  state.nextId = Number(state.nextId) || 1;
  state.runs = Array.isArray(state.runs) ? state.runs : [];
  return state;
}

function persist(state: Store) {
  store.persist(state);
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
