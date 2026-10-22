import type { IndexQuote } from "../dhan/instruments";
import type { OptionChainData } from "../dhan/option-chain-types";
import type { PlaybookSnapshot } from "../strategies/registry";
import { walletFromPaperTrades } from "./wallet";
import {
  computeMetrics,
  type BacktestTrade,
  type BacktestResult,
} from "./backtest-shared";
import type { PaperRun, PaperTrade } from "./paper-store.server";

const NOW = "2026-10-22T07:42:00.000Z";

function side(last: number, oi: number): NonNullable<OptionChainData["rows"][0]["ce"]> {
  return {
    lastPrice: last,
    oi,
    volume: Math.round(oi * 0.08),
    iv: 12.4,
    bid: Math.max(0.05, last - 0.4),
    ask: last + 0.4,
    delta: 0.5,
    theta: -8,
    gamma: 0.002,
    vega: 4,
  };
}

export function demoQuotes(): IndexQuote[] {
  return [
    {
      id: "NIFTY",
      name: "Nifty 50",
      securityId: 13,
      price: 25842.3,
      change: 86.45,
      changePercent: 0.34,
      open: 25755.1,
      high: 25891,
      low: 25721,
      prevClose: 25755.85,
      updatedAt: NOW,
    },
    {
      id: "BANKNIFTY",
      name: "Bank Nifty",
      securityId: 25,
      price: 58120.4,
      change: -42.15,
      changePercent: -0.07,
      open: 58180,
      high: 58310,
      low: 57990,
      prevClose: 58162.55,
      updatedAt: NOW,
    },
    {
      id: "SENSEX",
      name: "Sensex",
      securityId: 51,
      price: 84410.2,
      change: 312.8,
      changePercent: 0.37,
      open: 84102.4,
      high: 84580,
      low: 84055,
      prevClose: 84097.4,
      updatedAt: NOW,
    },
  ];
}

export function demoFeedSnapshot() {
  const quotes: Record<string, IndexQuote> = {};
  for (const quote of demoQuotes()) quotes[quote.id] = quote;
  return {
    status: "connected" as const,
    error: null as string | null,
    mode: "polling" as const,
    quotes,
  };
}

const niftyRun: PaperRun = {
  id: 1,
  instrument_id: "NIFTY",
  strategy_id: "EXPIRY_TREND_CREDIT",
  width_steps: 2,
  status: "active",
  created_at: "2026-10-01T03:30:00.000Z",
  updated_at: NOW,
};
const sensexRun: PaperRun = {
  id: 2,
  instrument_id: "SENSEX",
  strategy_id: "EXPIRY_TREND_CREDIT",
  width_steps: 2,
  status: "active",
  created_at: "2026-10-01T03:30:00.000Z",
  updated_at: NOW,
};

const closedSep: PaperTrade = {
  id: 9,
  run_id: 1,
  strategy_id: "EXPIRY_TREND_CREDIT",
  status: "closed",
  short_strike: 25150,
  long_strike: 25300,
  short_side: "CE",
  long_side: "CE",
  credit: 31.6,
  width: 150,
  spot_entry: 25140,
  spot_exit: 25088,
  pnl_points: 27.1,
  pnl_inr: 1761.5,
  brokerage_inr: 80,
  entry_at: "2026-09-22T07:31:00.000Z",
  expiry_at: "2026-09-22",
  expiry_session: true,
  exit_at: "2026-09-22T09:45:00.000Z",
  entry_hour: 13,
  legs: [
    { right: "CE", strike: 25150, strikeKey: "ATM", qty: -1, premium: 44.8 },
    { right: "CE", strike: 25300, strikeKey: "ATM+3", qty: 1, premium: 13.2 },
  ],
};

const closedNifty: PaperTrade = {
  id: 11,
  run_id: 1,
  strategy_id: "EXPIRY_TREND_CREDIT",
  status: "closed",
  short_strike: 25800,
  long_strike: 25950,
  short_side: "PE",
  long_side: "PE",
  credit: 34.2,
  width: 150,
  spot_entry: 25790,
  spot_exit: 25864,
  pnl_points: 28.4,
  pnl_inr: 1846,
  brokerage_inr: 80,
  entry_at: "2026-10-20T07:31:00.000Z",
  expiry_at: "2026-10-20",
  expiry_session: true,
  exit_at: "2026-10-20T09:45:00.000Z",
  entry_hour: 13,
  legs: [
    { right: "PE", strike: 25800, strikeKey: "ATM", qty: -1, premium: 48.1 },
    { right: "PE", strike: 25950, strikeKey: "ATM+3", qty: 1, premium: 13.9 },
  ],
};

const openSensex: PaperTrade = {
  id: 12,
  run_id: 2,
  strategy_id: "EXPIRY_TREND_CREDIT",
  status: "open",
  short_strike: 84400,
  long_strike: 84700,
  short_side: "CE",
  long_side: "CE",
  credit: 91.5,
  width: 300,
  spot_entry: 84405,
  spot_exit: null,
  pnl_points: 18.2,
  pnl_inr: 364,
  brokerage_inr: 80,
  entry_at: "2026-10-22T07:31:00.000Z",
  expiry_at: "2026-10-22",
  expiry_session: true,
  exit_at: null,
  entry_hour: 13,
  mark_pnl_points: 18.2,
  mark_pnl_inr: 364,
  mark_spot: 84410,
  mark_at: NOW,
  legs: [
    { right: "CE", strike: 84400, strikeKey: "ATM", qty: -1, premium: 128 },
    { right: "CE", strike: 84700, strikeKey: "ATM+3", qty: 1, premium: 36.5 },
  ],
};

function withInstrument(trade: PaperTrade) {
  const instrument_id = trade.run_id === 1 ? "NIFTY" : "SENSEX";
  const lot = instrument_id === "NIFTY" ? 65 : 20;
  const brokerage_inr = trade.brokerage_inr ?? 80;
  const pnl_after =
    trade.pnl_inr == null ? null : trade.pnl_inr - brokerage_inr;
  return {
    ...trade,
    instrument_id,
    margin_inr: trade.width * lot * 0.4,
    brokerage_inr,
    pnl_after_brokerage_inr: pnl_after,
  };
}

export function demoPaperSnapshot() {
  const trades = [openSensex, closedNifty, closedSep].map(withInstrument);
  return {
    activeRuns: [niftyRun, sensexRun],
    active: niftyRun,
    runs: [niftyRun, sensexRun],
    trades,
    wallet: walletFromPaperTrades(trades),
  };
}

export function demoLivePaperTrades() {
  const snapshot = demoPaperSnapshot();
  const trades = snapshot.trades.filter((t) => t.status === "open");
  return {
    trades,
    totalPnlInr: trades.reduce((sum, t) => sum + (t.mark_pnl_inr ?? 0), 0),
    asOf: NOW,
    wallet: snapshot.wallet,
  };
}

export function demoPaperCsv() {
  const rows = [
    "Trade ID,Index,Status,Credit,P&L INR,Brokerage INR,Entry,Expiry",
    "11,NIFTY,closed,34.2,1846,80,2026-10-20,2026-10-20",
    "9,NIFTY,closed,31.6,1761.5,80,2026-09-22,2026-09-22",
    "12,SENSEX,open,91.5,,80,2026-10-22,2026-10-22",
  ];
  return `${rows.join("\n")}\n`;
}

function baseStructure(spot: number, open: number, extra: Partial<PlaybookSnapshot["structure"]> = {}) {
  return {
    day: "2026-10-22",
    spot,
    open,
    priorHigh: open * 1.004,
    priorLow: open * 0.996,
    priorClose: open,
    morningHigh: spot + 80,
    morningLow: open - 40,
    orbBrokenUp: spot > open,
    orbBrokenDown: false,
    quietDay: false,
    insidePriorRange: false,
    maxPain: spot,
    putOiSupport: spot - 200,
    callOiResistance: spot + 400,
    distToMaxPain: 10,
    sessionHigh: spot + 80,
    sessionLow: open - 40,
    ...extra,
  };
}

export function demoPlaybookSnapshot(instrumentId = "SENSEX"): PlaybookSnapshot {
  if (instrumentId === "SENSEX") {
    const card = {
      id: "EXPIRY_TREND_CREDIT",
      strategyId: "EXPIRY_TREND_CREDIT",
      name: "Expiry Trend Credit",
      bias: "Bearish expiry",
      description: "Expiry fade up from open — sell 84400/84700 CE credit",
      legs: openSensex.legs ?? [],
      netCredit: 91.5,
      maxProfit: 91.5,
      maxLoss: 208.5,
      width: 300,
      primaryShortStrike: 84400,
      primaryLongStrike: 84700,
      primaryShortSide: "CE" as const,
      primaryLongSide: "CE" as const,
      available: true,
    };
    return {
      spreads: [card],
      structure: baseStructure(84410, 84102),
      hour: 13,
      isExpiryDay: true,
      inEntryWindow: true,
      picks: [
        {
          strategyId: "EXPIRY_TREND_CREDIT",
          name: "Expiry Trend Credit",
          reason: card.description,
        },
      ],
      pick: {
        strategyId: "EXPIRY_TREND_CREDIT",
        name: "Expiry Trend Credit",
        reason: card.description,
      },
      sitReason: null,
      path: [{ id: "EXPIRY_TREND_CREDIT", name: "Expiry Trend Credit", status: "picked" }],
    };
  }

  const sit =
    instrumentId === "NIFTY"
      ? "Nifty weekly expiry is Tuesday. Today is Thursday Sensex expiry — switch index to Sensex."
      : "Bank Nifty is not in the live playbook.";

  return {
    spreads: [],
    structure: baseStructure(
      instrumentId === "NIFTY" ? 25842 : 58120,
      instrumentId === "NIFTY" ? 25755 : 58180,
    ),
    hour: 13,
    isExpiryDay: false,
    inEntryWindow: true,
    picks: [],
    pick: null,
    sitReason: sit,
    path: [{ id: "EXPIRY_TREND_CREDIT", name: "Expiry Trend Credit", status: "blocked" }],
  };
}

function sampleBacktestTrade(
  day: string,
  won: boolean,
  pnlInr: number,
  credit: number,
): BacktestTrade {
  const pnlPoints = pnlInr / 65;
  return {
    strategyId: "EXPIRY_TREND_CREDIT",
    strategyName: "Expiry Trend Credit",
    entryDay: day,
    expiryDay: day,
    entryHour: 13,
    entryMinute: 0,
    exitHour: 15,
    exitMinute: 15,
    shortStrike: 25800,
    longStrike: 25950,
    shortSide: "PE",
    longSide: "PE",
    credit,
    width: 150,
    spotEntry: 25780,
    spotExpiry: won ? 25910 : 25640,
    pnlPoints,
    pnlInr,
    won,
    pickReason: "Expiry with up from open — sell ATM PE credit",
    exitReason: won ? "Flat by 15:15" : "Stop 3× credit",
    expirySession: true,
    legCount: 2,
    brokerageInr: 80,
    pnlAfterBrokerageInr: pnlInr - 80,
    marginInr: 7500,
  };
}

const demoBacktestTrades: BacktestTrade[] = [
  sampleBacktestTrade("2026-09-01", true, 1420, 31),
  sampleBacktestTrade("2026-09-08", true, 1680, 36),
  sampleBacktestTrade("2026-09-15", false, -2100, 33),
  sampleBacktestTrade("2026-09-22", true, 1540, 29),
  sampleBacktestTrade("2026-10-06", true, 1710, 38),
  sampleBacktestTrade("2026-10-13", true, 1490, 34),
  sampleBacktestTrade("2026-10-20", true, 1846, 34),
];

export function demoBacktestResult(): BacktestResult {
  return {
    instrumentId: "NIFTY",
    strategyIds: ["EXPIRY_TREND_CREDIT"],
    widthSteps: 2,
    from: "2025-10-22",
    to: "2026-10-22",
    lotSize: 65,
    mode: "single",
    metrics: computeMetrics(demoBacktestTrades, "NIFTY"),
    trades: demoBacktestTrades,
  };
}

export function demoSavedBacktest() {
  return {
    ...demoBacktestResult(),
    id: 1,
    savedAt: "2026-10-21T18:02:00.000Z",
  };
}

export function demoSavedBacktests() {
  const result = demoSavedBacktest();
  const { metrics } = result;
  return [
    {
      id: result.id,
      savedAt: result.savedAt,
      instrumentId: result.instrumentId,
      strategyIds: result.strategyIds,
      from: result.from,
      to: result.to,
      trades: metrics.trades,
      winRate: metrics.winRate,
      totalPnlInr: metrics.totalPnlInr,
      brokerageInr: metrics.brokerageInr,
      totalPnlAfterBrokerageInr: metrics.totalPnlAfterBrokerageInr,
      avgMarginInr: metrics.avgMarginInr,
      walletEndInr: metrics.walletEndInr,
      skippedForMargin: metrics.skippedForMargin,
    },
  ];
}

export function demoBacktestJob() {
  return {
    status: "idle" as const,
    message: "Demo sample — Nifty 12-month Expiry Trend Credit",
    done: 0,
    total: 0,
    cached: 0,
    fetched: 0,
    startedAt: null,
    finishedAt: null,
    error: null,
    resultId: 1,
    pid: null,
  };
}

export function demoOptionChain(instrumentId = "NIFTY"): OptionChainData {
  const specs: Record<string, { spot: number; atm: number; step: number; expiry: string }> = {
    NIFTY: { spot: 25842, atm: 25850, step: 50, expiry: "2026-10-27" },
    SENSEX: { spot: 84410, atm: 84400, step: 100, expiry: "2026-10-22" },
    BANKNIFTY: { spot: 58120, atm: 58100, step: 100, expiry: "2026-10-27" },
  };
  const spec = specs[instrumentId] ?? specs.NIFTY;
  const rows = [-3, -2, -1, 0, 1, 2, 3].map((i) => {
    const strike = spec.atm + i * spec.step;
    const ceLast = Math.max(4, 48 - i * 14);
    const peLast = Math.max(4, 46 + i * 14);
    return {
      strike,
      ce: side(ceLast, 1_200_000 - i * 80_000),
      pe: side(peLast, 980_000 + i * 70_000),
    };
  });
  return {
    spot: spec.spot,
    expiry: spec.expiry,
    expiries: [spec.expiry, "2026-11-03"],
    rows,
  };
}

export function demoAuthStatus() {
  return {
    connected: false,
    source: null as "totp" | "env" | null,
    clientId: null as string | null,
    clientName: null as string | null,
    expiryTime: null as string | null,
    minutesLeft: null as number | null,
    expired: false,
    totpReady: false,
    envTokenPresent: false,
  };
}
