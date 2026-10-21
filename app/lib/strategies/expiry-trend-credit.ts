import {
  assertStrategy,
  atmIndex,
  buildProposal,
  longPremium,
  premiumAt,
  settleLegs,
  shortPremium,
  strikeAt,
  strikeKey,
} from "./common";
import { isExpirySessionCtx } from "./expiry-day";
import type { EntryContext, OpenPosition, OptionRight, Strategy } from "./types";

export const EXPIRY_TREND_ID = "EXPIRY_TREND_CREDIT";

export type ExpiryTrendSpec = {
  mode: "trend" | "fade";
  startMin: number;
  endMin: number;
  shortSteps: number;
  wingSteps: number;
  /** Skip unless |spot − open| / open exceeds this percent. */
  minMovePct: number;
  stopMult: number;
};

const SPECS: Record<string, ExpiryTrendSpec> = {
  // Nifty Tuesday 0DTE: ATM credit with the midday trend. k1w2 @12:30 won
  // more often (~85%) but made ~₹16k/year less after costs.
  NIFTY: {
    mode: "trend",
    startMin: 13 * 60,
    endMin: 13 * 60 + 15,
    shortSteps: 0,
    wingSteps: 3,
    minMovePct: 0,
    stopMult: 3,
  },
  // Sensex Thursday 0DTE: fade a 0.2%+ move, short ATM (more credit than 1-OTM).
  SENSEX: {
    mode: "fade",
    startMin: 13 * 60,
    endMin: 13 * 60 + 15,
    shortSteps: 0,
    wingSteps: 3,
    minMovePct: 0.2,
    stopMult: 3,
  },
};

export function expiryTrendSpec(instrumentId: string): ExpiryTrendSpec | null {
  return SPECS[instrumentId] ?? null;
}

export function inExpiryTrendWindow(
  hour: number,
  minute: number | undefined,
  instrumentId?: string,
) {
  const spec = expiryTrendSpec(instrumentId ?? "NIFTY");
  if (!spec) return false;
  const t = hour * 60 + (minute ?? 0);
  return t >= spec.startMin && t < spec.endMin;
}

function sessionMovePct(ctx: EntryContext) {
  const open = ctx.structure.open;
  if (!open || !ctx.spot) return 0;
  return ((ctx.spot - open) / open) * 100;
}

function tradeDirection(ctx: EntryContext, spec: ExpiryTrendSpec): "up" | "down" | null {
  const move = sessionMovePct(ctx);
  if (Math.abs(move) < spec.minMovePct || move === 0) return null;
  const up = move > 0;
  if (spec.mode === "trend") return up ? "up" : "down";
  return up ? "down" : "up";
}

/**
 * Expiry-day credit. Nifty rides the midday trend; Sensex fades a 0.2%+ move.
 * Flatten 15:15, stop 3× credit.
 */
export const expiryTrendCreditStrategy = assertStrategy({
  id: EXPIRY_TREND_ID,
  name: "Expiry Trend Credit",
  bias: "Expiry-day credit (Nifty with trend, Sensex fade)",
  description:
    "Nifty Tue 13:00 ATM with the trend. Sensex Thu 13:00 ATM fade after 0.2%. Stop 3×, flat 15:15. Bank Nifty skipped.",
  requiredStrikeKeys() {
    let far = 3;
    for (const spec of Object.values(SPECS)) {
      far = Math.max(far, spec.shortSteps + spec.wingSteps);
    }
    return [
      strikeKey(-far),
      strikeKey(-1),
      strikeKey(0),
      strikeKey(1),
      strikeKey(far),
    ];
  },
  isEligible(ctx) {
    const spec = expiryTrendSpec(ctx.instrument.id);
    if (!spec) return false;
    if (!isExpirySessionCtx(ctx)) return false;
    if (!inExpiryTrendWindow(ctx.hour, ctx.minute, ctx.instrument.id)) return false;
    return tradeDirection(ctx, spec) !== null;
  },
  proposeEntry(ctx) {
    const spec = expiryTrendSpec(ctx.instrument.id);
    if (!spec) return null;
    const dir = tradeDirection(ctx, spec);
    if (!dir) return null;
    const right: OptionRight = dir === "up" ? "PE" : "CE";
    const away = dir === "up" ? -1 : 1;
    const shortSteps = away * spec.shortSteps;
    const longSteps = away * (spec.shortSteps + spec.wingSteps);

    let shortPx: number | null | undefined;
    let longPx: number | null | undefined;
    let shortStrike: number | undefined;
    let longStrike: number | undefined;
    if (ctx.rows && ctx.rows.length > 0) {
      const atm = atmIndex(ctx.rows, ctx.spot);
      const shortRow = ctx.rows[atm + shortSteps];
      const longRow = ctx.rows[atm + longSteps];
      if (!shortRow || !longRow) return null;
      shortPx = shortPremium(right === "CE" ? shortRow.ce : shortRow.pe);
      longPx = longPremium(right === "CE" ? longRow.ce : longRow.pe);
      shortStrike = shortRow.strike;
      longStrike = longRow.strike;
    } else {
      shortPx = premiumAt(ctx.premiums, strikeKey(shortSteps), right);
      longPx = premiumAt(ctx.premiums, strikeKey(longSteps), right);
      shortStrike = strikeAt(ctx.strikes, strikeKey(shortSteps));
      longStrike = strikeAt(ctx.strikes, strikeKey(longSteps));
    }
    if (!shortPx || !longPx || shortStrike === undefined || longStrike === undefined) {
      return null;
    }
    const credit = shortPx - longPx;
    if (credit <= 0) return null;
    const width = Math.abs(shortStrike - longStrike);
    const verb = spec.mode === "fade" ? "fade" : "with";
    return buildProposal({
      strategyId: EXPIRY_TREND_ID,
      name: "Expiry Trend Credit",
      bias: dir === "up" ? "Bullish expiry" : "Bearish expiry",
      description: `Expiry ${verb} ${sessionMovePct(ctx) > 0 ? "up" : "down"} from open — sell ${shortStrike}/${longStrike} ${right} credit`,
      legs: [
        { right, strike: shortStrike, strikeKey: strikeKey(shortSteps), qty: -1, premium: shortPx },
        { right, strike: longStrike, strikeKey: strikeKey(longSteps), qty: 1, premium: longPx },
      ],
      maxProfit: credit,
      maxLoss: Math.max(0, width - credit),
    });
  },
  settle(position: OpenPosition, spot, premiums) {
    return settleLegs(position, spot, premiums);
  },
} satisfies Strategy);

export const EXPIRY_TREND_DEFAULTS = {
  stopMult: 3,
  flatByHour: 15,
  flatByMinute: 15,
};
