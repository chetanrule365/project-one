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
  /** Minute of `flatByHour` (0 = on the hour). Afternoon reversal uses 15. */
  flatByMinute?: number;
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
  /** Session high / low when a live quote is available. */
  sessionHigh?: number;
  sessionLow?: number;
};

export type EntryContext = {
  instrument: IndexInstrument;
  spot: number;
  widthSteps: number;
  hour: number;
  /** IST minute (0–59). Omitted in hourly backtests. */
  minute?: number;
  structure: DayStructure;
  rows?: OptionChainRow[];
  /** Premiums keyed "ATM:CE" etc. at decision bar */
  premiums?: Record<string, number>;
  strikes?: Record<string, number>;
  /** Hourly bars for the session keyed by series */
  hourlyByKey?: Record<string, Array<{ hour: number; bar: RollingBar }>>;
  /**
   * True when this session is the contract's expiry (weekly weekday / holiday shift).
   * Undefined is treated as expiry for backward-compatible tests.
   */
  expirySession?: boolean;
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

/** Morning credits / expiry flatten from this IST hour (frees the afternoon slot). */
export const FLAT_BY_HOUR = 14;

/** Paper worker keeps managing open trades while IST hour < this */
export const SESSION_MANAGE_UNTIL_HOUR = 16;

/** Morning playbook (ORB / IC / OI fade / max pain) entry until this IST hour. */
export const MORNING_ENTRY_UNTIL_HOUR = 14;

/** Afternoon S/R reversal: arm only in this IST hour, until `PM_REVERSAL_ENTRY_UNTIL_MINUTE`. */
export const PM_REVERSAL_ENTRY_HOUR = 14;
export const PM_REVERSAL_ENTRY_UNTIL_MINUTE = 15;
/** Flatten afternoon reversal from this IST clock. */
export const PM_REVERSAL_FLAT_HOUR = 15;
export const PM_REVERSAL_FLAT_MINUTE = 15;

export const MORNING_PLAYBOOK_NAME = "Morning Playbook";
export const MORNING_PLAYBOOK_WINDOW = "10:00–14:00 IST";

export function inMorningEntryWindow(hour: number) {
  return hour >= 10 && hour < MORNING_ENTRY_UNTIL_HOUR;
}

/** Live: 14:00–14:15. Omitted minute counts as :00 (hourly 14:00 snapshot). */
export function inPmReversalEntryWindow(hour: number, minute?: number) {
  if (hour !== PM_REVERSAL_ENTRY_HOUR) return false;
  return (minute ?? 0) < PM_REVERSAL_ENTRY_UNTIL_MINUTE;
}

export function pastPmReversalFlat(hour: number, minute = 0) {
  if (hour > PM_REVERSAL_FLAT_HOUR) return true;
  if (hour < PM_REVERSAL_FLAT_HOUR) return false;
  return minute >= PM_REVERSAL_FLAT_MINUTE;
}

export function istClock(at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return { hour: pick("hour"), minute: pick("minute") };
}

/** Opening-range proxy: first N hourly bars */
export const ORB_HOURS = 1;

/** No new long buys after this hour */
export const NO_LONG_AFTER_HOUR = 13;

/** ORB ATM entries only in this IST hour window (10 ≤ hour < this). */
export const ORB_ENTRY_UNTIL_HOUR = 11;

/** Quiet day: prior range below this % of spot */
export const QUIET_PRIOR_RANGE_PCT = 1.8;

/** Live session: treat as quiet if today's high–low is within this % of prev close. */
export const LIVE_QUIET_RANGE_PCT = 1.2;

/** Live ORB: break vs open must exceed this fraction of spot. */
export const ORB_BREAK_PCT = 0.004;

export const ORB_MIN_BREAK_PTS: Record<string, number> = {
  NIFTY: 80,
  BANKNIFTY: 180,
  SENSEX: 280,
};

/** Skip expiry ATM buys when ask is richer than this (points). */
export const MAX_EXPIRY_DEBIT_PTS: Record<string, number> = {
  NIFTY: 70,
  BANKNIFTY: 140,
  SENSEX: 90,
};

/** Cap on non-expiry ORB debit-spread cost (long ATM, short further OTM). */
export const MAX_DAILY_DEBIT_PTS: Record<string, number> = {
  NIFTY: 80,
  BANKNIFTY: 160,
  SENSEX: 120,
};

/** Max-pain distance band (pts) */
export const MAX_PAIN_MIN_DIST = 80;
export const MAX_PAIN_MAX_DIST = 200;

export const LOT_SIZES: Record<string, number> = {
  NIFTY: 65,
  BANKNIFTY: 30,
  SENSEX: 20,
};

/** Hedged iron-condor SPAN ≈ this fraction of index notional (Dhan Nifty IC ~₹70k). */
export const IC_SPAN_NOTIONAL_FRAC = 0.044;

export function lotSizeFor(instrumentId: string) {
  return LOT_SIZES[instrumentId] ?? 1;
}
