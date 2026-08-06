import type { OptionChainRow } from "../dhan/option-chain";
import type { IndexInstrument } from "../dhan/instruments";
import type { RollingBar } from "../dhan/rolling-options";

export type OptionRight = "CE" | "PE";

export type Leg = {
  right: OptionRight;
  strike: number;
  strikeKey: string;
  /** +1 long, -1 short */
  qty: number;
  premium: number;
};

export type TradeProposal = {
  strategyId: string;
  name: string;
  bias: string;
  description: string;
  legs: Leg[];
  /** Net credit (>0 sell) or debit (<0 buy) in index points */
  netCredit: number;
  maxProfit: number;
  maxLoss: number;
  width: number;
  /** Paper-store / UI summary legs */
  primaryShortStrike: number;
  primaryLongStrike: number;
  primaryShortSide: OptionRight;
  primaryLongSide: OptionRight;
};

/** @deprecated alias — kept for gradual migration */
export type CreditSpreadProposal = TradeProposal;

export type OpenPosition = {
  strategyId: string;
  legs: Leg[];
  netCredit: number;
  width: number;
  entryAt: string;
  expiryAt: string;
  entryHour?: number;
  /** Take-profit as fraction of |maxProfit| (e.g. 0.6) */
  takeProfitFrac?: number;
  /** Stop as multiple of |netCredit| risk (e.g. 2 for credit, 0.35 for debit) */
  stopMult?: number;
  /** Force flat at/after this IST hour */
  flatByHour?: number;
  /** Time stop: exit after this many hours from entry */
  timeStopHours?: number;
  /** Spot target (max-pain halfway, etc.) */
  targetSpot?: number;
  /** Adverse spot stop level */
  stopSpot?: number;
};

export type DayStructure = {
  day: string;
  spot: number;
  open: number;
  priorHigh: number;
  priorLow: number;
  priorClose: number;
  morningHigh: number;
  morningLow: number;
  orbBrokenUp: boolean;
  orbBrokenDown: boolean;
  quietDay: boolean;
  insidePriorRange: boolean;
  maxPain: number | null;
  putOiSupport: number | null;
  callOiResistance: number | null;
  distToMaxPain: number | null;
};

export type EntryContext = {
  instrument: IndexInstrument;
  spot: number;
  widthSteps: number;
  hour: number;
  structure: DayStructure;
  rows?: OptionChainRow[];
  /** Premiums keyed "ATM:CE" etc. at decision bar */
  premiums?: Record<string, number>;
  strikes?: Record<string, number>;
  /** Hourly bars for the expiry day keyed by series */
  hourlyByKey?: Record<string, Array<{ hour: number; bar: RollingBar }>>;
};

export type Strategy = {
  id: string;
  name: string;
  bias: string;
  description: string;
  requiredStrikeKeys: (widthSteps: number) => string[];
  /** Whether this path fits the day's structure at this hour */
  isEligible(ctx: EntryContext): boolean;
  proposeEntry(ctx: EntryContext): TradeProposal | null;
  /** P&L in index points (1 lot multiplier applied by engine) */
  settle(position: OpenPosition, spot: number, markPremiums?: Record<string, number>): number;
};

/** Wing width in strike steps for IC / credit spreads (2 ≈ 100 Nifty pts) */
export const DEFAULT_WIDTH_STEPS = 2;

/** Credit IC / credit-spread stop: −N × credit */
export const STOP_LOSS_CREDIT_MULT = 2;

/** Debit option stop: fraction of premium lost */
export const STOP_LOSS_DEBIT_FRAC = 0.35;

/** Take profit fraction of max profit for premium sells */
export const TAKE_PROFIT_FRAC = 0.6;

/** Force flat premium sells from this IST hour */
export const FLAT_BY_HOUR = 14;

/** Opening-range proxy: first N hourly bars */
export const ORB_HOURS = 1;

/** No new long buys after this hour */
export const NO_LONG_AFTER_HOUR = 13;

/** Quiet day: prior range below this % of spot */
export const QUIET_PRIOR_RANGE_PCT = 1.8;

/** Max-pain distance band (pts) */
export const MAX_PAIN_MIN_DIST = 80;
export const MAX_PAIN_MAX_DIST = 200;

export const LOT_SIZES: Record<string, number> = {
  NIFTY: 65,
  BANKNIFTY: 30,
  SENSEX: 20,
};

export function lotSizeFor(instrumentId: string) {
  return LOT_SIZES[instrumentId] ?? 1;
}
