import { roundTripBrokerageInr } from "../strategies/cost-filter";
import { marginRequiredInr } from "./margin";
import { WALLET_START_INR } from "./wallet";

export { DHAN_FNO_BROKERAGE_PER_ORDER } from "../strategies/cost-filter";

export type BacktestTrade = {
  strategyId: string;
  strategyName: string;
  entryDay: string;
  expiryDay: string;
  entryHour: number;
  entryMinute?: number;
  exitHour: number;
  exitMinute?: number;
  shortStrike: number;
  longStrike: number;
  shortSide: string;
  longSide: string;
  credit: number;
  width: number;
  spotEntry: number;
  spotExpiry: number;
  pnlPoints: number;
  pnlInr: number;
  won: boolean;
  pickReason?: string;
  exitReason?: string;
  expirySession: boolean;
  legCount?: number;
  brokerageInr?: number;
  pnlAfterBrokerageInr?: number;
  marginInr?: number;
};

export type BacktestMetrics = {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnlPoints: number;
  totalPnlInr: number;
  avgPnlPoints: number;
  maxDrawdownInr: number;
  profitFactor: number;
  brokerageInr: number;
  totalPnlAfterBrokerageInr: number;
  avgMarginInr: number;
  walletStartInr: number;
  walletEndInr: number;
  skippedForMargin: number;
  peakLockedInr: number;
  byStrategy: StrategyNetRow[];
};

export type StrategyNetRow = {
  strategyId: string;
  strategyName: string;
  trades: number;
  wins: number;
  winRate: number;
  avgPnlPoints: number;
  totalPnlInr: number;
  brokerageInr: number;
  totalPnlAfterBrokerageInr: number;
};

export function inferLegCount(
  trade: Pick<BacktestTrade, "legCount" | "shortStrike" | "longStrike" | "strategyId">,
) {
  if (trade.legCount && trade.legCount > 0) return trade.legCount;
  if (trade.strategyId === "IRON_CONDOR") return 4;
  const short = trade.shortStrike > 0;
  const long = trade.longStrike > 0;
  if (short && long && trade.shortStrike !== trade.longStrike) return 2;
  return short || long ? 1 : 2;
}

export function tradeBrokerageInr(trade: BacktestTrade) {
  if (trade.brokerageInr != null && Number.isFinite(trade.brokerageInr)) {
    return trade.brokerageInr;
  }
  return roundTripBrokerageInr(inferLegCount(trade));
}

export function tradeMarginInr(trade: BacktestTrade, instrumentId = "NIFTY") {
  if (trade.marginInr != null && Number.isFinite(trade.marginInr)) {
    return trade.marginInr;
  }
  return marginRequiredInr({
    instrumentId,
    strategyId: trade.strategyId,
    credit: trade.credit,
    width: trade.width,
    spot: trade.spotEntry,
    legCount: inferLegCount(trade),
  });
}

export function tradePnlAfterBrokerageInr(trade: BacktestTrade) {
  if (
    trade.pnlAfterBrokerageInr != null &&
    Number.isFinite(trade.pnlAfterBrokerageInr)
  ) {
    return trade.pnlAfterBrokerageInr;
  }
  return trade.pnlInr - tradeBrokerageInr(trade);
}

export type BacktestResult = {
  instrumentId: string;
  strategyIds: string[];
  widthSteps: number;
  from: string;
  to: string;
  lotSize: number;
  mode: "single" | "auto";
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
};

export function computeMetrics(
  trades: BacktestTrade[],
  instrumentId?: string,
  extras?: { skippedForMargin?: number; peakLockedInr?: number },
): BacktestMetrics {
  const wins = trades.filter((t) => tradePnlAfterBrokerageInr(t) > 0).length;
  const losses = trades.length - wins;
  const totalPnlPoints = trades.reduce((s, t) => s + t.pnlPoints, 0);
  const totalPnlInr = trades.reduce((s, t) => s + t.pnlInr, 0);
  const brokerageInr = trades.reduce((s, t) => s + tradeBrokerageInr(t), 0);
  const nets = trades.map((t) => tradePnlAfterBrokerageInr(t));
  const grossProfit = nets.filter((n) => n > 0).reduce((s, n) => s + n, 0);
  const grossLoss = Math.abs(nets.filter((n) => n < 0).reduce((s, n) => s + n, 0));
  const totalPnlAfterBrokerageInr = totalPnlInr - brokerageInr;

  let equity = WALLET_START_INR;
  let peak = WALLET_START_INR;
  let maxDrawdownInr = 0;
  for (const net of nets) {
    equity += net;
    peak = Math.max(peak, equity);
    maxDrawdownInr = Math.max(maxDrawdownInr, peak - equity);
  }

  return {
    trades: trades.length,
    wins,
    losses,
    winRate: trades.length ? (wins / trades.length) * 100 : 0,
    totalPnlPoints,
    totalPnlInr,
    avgPnlPoints: trades.length ? totalPnlPoints / trades.length : 0,
    maxDrawdownInr,
    profitFactor:
      grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    brokerageInr,
    totalPnlAfterBrokerageInr,
    avgMarginInr: trades.length
      ? trades.reduce((s, t) => s + tradeMarginInr(t, instrumentId), 0) /
        trades.length
      : 0,
    walletStartInr: WALLET_START_INR,
    walletEndInr: WALLET_START_INR + totalPnlAfterBrokerageInr,
    skippedForMargin: extras?.skippedForMargin ?? 0,
    peakLockedInr: extras?.peakLockedInr ?? 0,
    byStrategy: strategyNetRows(trades),
  };
}

export function strategyNetRows(trades: BacktestTrade[]): StrategyNetRow[] {
  const byId = new Map<string, BacktestTrade[]>();
  for (const trade of trades) {
    const rows = byId.get(trade.strategyId) ?? [];
    rows.push(trade);
    byId.set(trade.strategyId, rows);
  }
  return [...byId.entries()].map(([strategyId, rows]) => {
    const metrics = computeMetricsWithoutBreakdown(rows);
    return {
      strategyId,
      strategyName: rows[0]?.strategyName ?? strategyId,
      trades: metrics.trades,
      wins: metrics.wins,
      winRate: metrics.winRate,
      avgPnlPoints: metrics.avgPnlPoints,
      totalPnlInr: metrics.totalPnlInr,
      brokerageInr: metrics.brokerageInr,
      totalPnlAfterBrokerageInr: metrics.totalPnlAfterBrokerageInr,
    };
  });
}

function computeMetricsWithoutBreakdown(trades: BacktestTrade[]) {
  const wins = trades.filter((t) => tradePnlAfterBrokerageInr(t) > 0).length;
  const totalPnlPoints = trades.reduce((s, t) => s + t.pnlPoints, 0);
  const totalPnlInr = trades.reduce((s, t) => s + t.pnlInr, 0);
  const brokerageInr = trades.reduce((s, t) => s + tradeBrokerageInr(t), 0);
  return {
    trades: trades.length,
    wins,
    winRate: trades.length ? (wins / trades.length) * 100 : 0,
    avgPnlPoints: trades.length ? totalPnlPoints / trades.length : 0,
    totalPnlInr,
    brokerageInr,
    totalPnlAfterBrokerageInr: totalPnlInr - brokerageInr,
  };
}
