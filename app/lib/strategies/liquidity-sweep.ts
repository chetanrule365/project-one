import {
  atmIndex,
  buildProposal,
  longPremium,
  premiumAt,
  settleLegs,
  shortPremium,
  strikeAt,
  strikeKey,
} from "./common";
import { daysToExpiry, isMonthlyExpiryIndex } from "./expiry-day";
import {
  TAKE_PROFIT_FRAC,
  inSweepEntryWindow,
  type EntryContext,
  type OpenPosition,
  type Strategy,
  type SweepSignal,
  type TradeProposal,
} from "./types";

export const SWEEP_FADE_ID = "SWEEP_FADE";

export type SweepBar = {
  day: string;
  hour: number;
  minute: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

const BUFFER: Record<string, number> = {
  NIFTY: 20,
  BANKNIFTY: 50,
  SENSEX: 70,
};

const OPEN_MIN = 9 * 60 + 15;
const DECISION_MIN = 10 * 60;
const CUTOFF_MIN = 12 * 60;
/** Four closes still outside = real break. We sit that side out; we do not ride it. */
const HOLD_BARS = 4;
const VOLUME_LOOKBACK = 12;
const VOLUME_TRAP_MULT = 1.2;
/** Tight enough to hit before 15:15 on a Nifty 1-step credit. */
const SWEEP_STOP_CREDIT_MULT = 1;

export function sweepBuffer(instrumentId: string) {
  return BUFFER[instrumentId] ?? 20;
}

function barMinute(bar: SweepBar) {
  return bar.hour * 60 + bar.minute;
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

type Level = { name: string; price: number; side: "up" | "down" };

/**
 * Fade a failed stop-hunt: wick through prior/opening range, close back
 * inside on hot volume. A break that holds is not a credit-spread follow —
 * every ride variant lost money. OI walls and signals after 12:00 are ignored.
 */
export function detectLiquiditySweep(input: {
  bars: SweepBar[];
  priorHigh: number;
  priorLow: number;
  putOi: number | null;
  callOi: number | null;
  buffer: number;
  /** `latest` is the live tape. `first` is the backtest's first trade of the day. */
  pick?: "first" | "latest";
}): SweepSignal | null {
  const bars = [...input.bars].sort((a, b) => barMinute(a) - barMinute(b));
  const opening = bars.filter((bar) => {
    const minute = barMinute(bar);
    return minute >= OPEN_MIN && minute < DECISION_MIN;
  });
  const orHigh = opening.reduce((high, bar) => Math.max(high, bar.high), 0);
  const orLow = opening.reduce((low, bar) => Math.min(low, bar.low), Number.POSITIVE_INFINITY);
  const levels: Level[] = [];
  if (input.priorHigh > 0) levels.push({ name: "prior high", price: input.priorHigh, side: "up" });
  if (input.priorLow > 0) levels.push({ name: "prior low", price: input.priorLow, side: "down" });
  if (orHigh > 0) levels.push({ name: "opening high", price: orHigh, side: "up" });
  if (Number.isFinite(orLow)) levels.push({ name: "opening low", price: orLow, side: "down" });

  const decision = bars.filter((bar) => {
    const minute = barMinute(bar);
    return minute >= DECISION_MIN && minute <= CUTOFF_MIN;
  });
  const holds = new Map<string, number>();
  const blocked = new Set<"up" | "down">();
  const pick = input.pick ?? "first";
  let accepted: SweepSignal | null = null;

  for (const bar of decision) {
    const history = bars
      .slice(0, bars.indexOf(bar))
      .filter((row) => row.volume > 0)
      .slice(-VOLUME_LOOKBACK)
      .map((row) => row.volume);
    const base = median(history);
    const volumeRatio = base > 0 ? bar.volume / base : 0;
    const trapHot =
      history.length >= 4 && base > 0 && bar.volume >= base * VOLUME_TRAP_MULT;

    for (const level of levels) {
      const key = `${level.side}:${level.name}`;
      if (blocked.has(level.side)) continue;
      const through =
        level.side === "up"
          ? bar.high >= level.price + input.buffer
          : bar.low <= level.price - input.buffer;
      const backInside =
        level.side === "up" ? bar.close <= level.price : bar.close >= level.price;
      if (through && backInside && trapHot) {
        const trap: SweepSignal = {
          kind: level.side === "up" ? "trap-up" : "trap-down",
          levelName: level.name,
          level: level.price,
          hour: bar.hour,
          minute: bar.minute,
          volumeRatio,
        };
        if (pick === "first") return trap;
        accepted = trap;
        continue;
      }
      const stillOut =
        level.side === "up"
          ? bar.close > level.price + input.buffer
          : bar.close < level.price - input.buffer;
      const nextHold = stillOut ? (holds.get(key) ?? 0) + 1 : 0;
      holds.set(key, nextHold);
      if (nextHold >= HOLD_BARS) blocked.add(level.side);
    }
  }
  return accepted;
}

export function sweepIsFresh(signal: SweepSignal, hour: number, minute: number) {
  const age = hour * 60 + minute - (signal.hour * 60 + signal.minute);
  return age >= 0 && age <= 15;
}

export function isSweepTradeSignal(
  signal: SweepSignal | null | undefined,
): signal is SweepSignal {
  return Boolean(signal && (signal.kind === "trap-up" || signal.kind === "trap-down"));
}

/** Credit-spread side: fade traps, ride holds. `down` = bull put, `up` = bear call. */
export function sweepSpreadSide(kind: SweepSignal["kind"]): "up" | "down" {
  if (kind === "trap-down" || kind === "accept-up") return "down";
  return "up";
}

function spreadBias(kind: SweepSignal["kind"]): string {
  switch (kind) {
    case "trap-down":
      return "Fade a failed breakdown";
    case "trap-up":
      return "Fade a failed breakout";
    case "accept-up":
      return "Ride a held breakout";
    case "accept-down":
      return "Ride a held breakdown";
  }
}

function spreadFromPremiums(
  ctx: EntryContext,
  kind: SweepSignal["kind"],
  why: string,
): TradeProposal | null {
  const side = sweepSpreadSide(kind);
  const bias = spreadBias(kind);
  const width = Math.max(1, ctx.widthSteps);
  const shortKey = side === "down" ? strikeKey(-1) : strikeKey(1);
  const longKey = side === "down" ? strikeKey(-1 - width) : strikeKey(1 + width);
  const right = side === "down" ? "PE" : "CE";

  if (ctx.rows && ctx.rows.length > 0) {
    const atm = atmIndex(ctx.rows, ctx.spot);
    const shortRow = ctx.rows[side === "down" ? atm - 1 : atm + 1];
    const longRow = ctx.rows[side === "down" ? atm - 1 - width : atm + 1 + width];
    if (!shortRow || !longRow) return null;
    const shortSide = right === "PE" ? shortRow.pe : shortRow.ce;
    const longSide = right === "PE" ? longRow.pe : longRow.ce;
    const shortPx = shortPremium(shortSide);
    const longPx = longPremium(longSide);
    if (shortPx === null || longPx === null) return null;
    const credit = shortPx - longPx;
    if (credit <= 0) return null;
    const span = Math.abs(shortRow.strike - longRow.strike);
    return buildProposal({
      strategyId: SWEEP_FADE_ID,
      name: "Sweep",
      bias,
      description: why,
      legs: [
        { right, strike: shortRow.strike, strikeKey: shortKey, qty: -1, premium: shortPx },
        { right, strike: longRow.strike, strikeKey: longKey, qty: 1, premium: longPx },
      ],
      maxProfit: credit,
      maxLoss: Math.max(0, span - credit),
    });
  }

  const shortPx = premiumAt(ctx.premiums, shortKey, right);
  const longPx = premiumAt(ctx.premiums, longKey, right);
  const shortStrike = strikeAt(ctx.strikes, shortKey);
  const longStrike = strikeAt(ctx.strikes, longKey);
  if (
    shortPx === undefined ||
    longPx === undefined ||
    shortStrike === undefined ||
    longStrike === undefined
  ) {
    return null;
  }
  const credit = shortPx - longPx;
  if (credit <= 0) return null;
  return buildProposal({
    strategyId: SWEEP_FADE_ID,
    name: "Sweep",
    bias,
    description: why,
    legs: [
      { right, strike: shortStrike, strikeKey: shortKey, qty: -1, premium: shortPx },
      { right, strike: longStrike, strikeKey: longKey, qty: 1, premium: longPx },
    ],
    maxProfit: credit,
    maxLoss: Math.max(0, Math.abs(longStrike - shortStrike) - credit),
  });
}

export function sweepAllowsIndex(ctx: EntryContext) {
  if (!isMonthlyExpiryIndex(ctx.instrument.id)) return true;
  return daysToExpiry(ctx.instrument.id, ctx.structure.day) <= 1;
}

export function sweepPositionExtras(
  sweep?: SweepSignal | null,
): Partial<OpenPosition> {
  if (!sweep || !sweep.kind.startsWith("accept")) return {};
  return {
    reclaimSpot: sweep.level,
    reclaimDir: sweep.kind === "accept-up" ? "below" : "above",
  };
}

export const sweepFadeStrategy = {
  id: SWEEP_FADE_ID,
  name: "Sweep",
  bias: "Fade the failed stop-hunt",
  description:
    "A 5-minute wick through prior or opening range that closes back inside on high volume is a failed hunt — fade it. A break that holds is left alone. Credit spreads cannot follow smart money through a real break.",
  requiredStrikeKeys(widthSteps: number) {
    const width = Math.max(1, widthSteps);
    return [strikeKey(-1 - width), strikeKey(-1), strikeKey(1), strikeKey(1 + width)];
  },
  isEligible(ctx: EntryContext) {
    if (!isSweepTradeSignal(ctx.sweep)) return false;
    if (!inSweepEntryWindow(ctx.hour, ctx.minute ?? 0)) return false;
    return sweepAllowsIndex(ctx);
  },
  proposeEntry(ctx: EntryContext) {
    const sweep = ctx.sweep;
    if (!isSweepTradeSignal(sweep)) return null;
    const side = sweepSpreadSide(sweep.kind);
    const product = side === "down" ? "Bull put" : "Bear call";
    const why = `Trap at ${sweep.levelName} ${Math.round(sweep.level)} — volume ${sweep.volumeRatio.toFixed(1)}×. ${product}, flatten 15:15.`;
    return spreadFromPremiums(ctx, sweep.kind, why);
  },
  settle(position: OpenPosition, spot: number, premiums?: Record<string, number>) {
    return settleLegs(position, spot, premiums);
  },
} satisfies Strategy;

export const SWEEP_FADE_DEFAULTS = {
  takeProfitFrac: TAKE_PROFIT_FRAC,
  stopMult: SWEEP_STOP_CREDIT_MULT,
  flatByHour: 15,
  flatByMinute: 15,
};

export function describeSweep(signal: SweepSignal) {
  if (signal.kind === "trap-down" || signal.kind === "trap-up") {
    return `Trap at ${signal.levelName} ${Math.round(signal.level)} (${signal.volumeRatio.toFixed(1)}× volume)`;
  }
  return `Break holds through ${signal.levelName} ${Math.round(signal.level)} (${signal.volumeRatio.toFixed(1)}× volume)`;
}
