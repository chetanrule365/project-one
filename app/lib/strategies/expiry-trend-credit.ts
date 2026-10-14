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

/** Entry window on expiry day, IST minutes since midnight (end exclusive). */
export const EXPIRY_TREND_START_MIN = 12 * 60 + 30;
export const EXPIRY_TREND_END_MIN = 12 * 60 + 45;

/** Only Nifty held up out of sample; Sensex lost at every entry time. */
const EXPIRY_TREND_INDICES = new Set(["NIFTY"]);
const SHORT_STEPS = 1;
const WING_STEPS = 2;

export function inExpiryTrendWindow(hour: number, minute: number | undefined) {
  const t = hour * 60 + (minute ?? 0);
  return t >= EXPIRY_TREND_START_MIN && t < EXPIRY_TREND_END_MIN;
}

function trendDirection(ctx: EntryContext): "up" | "down" | null {
  const open = ctx.structure.open;
  if (!open || !ctx.spot || ctx.spot === open) return null;
  return ctx.spot > open ? "up" : "down";
}

/**
 * Expiry-day trend credit: by midday the session has picked a side. Sell the
 * OTM credit spread on the side price is moving away from and let expiry decay
 * do the work into 15:15.
 */
export const expiryTrendCreditStrategy = assertStrategy({
  id: EXPIRY_TREND_ID,
  name: "Expiry Trend Credit",
  bias: "Credit with the expiry-day trend",
  description:
    "Nifty expiry, 12:30 IST: above the open → sell an OTM put spread; below → sell an OTM call spread. Stop 3× credit, flat 15:15.",
  requiredStrikeKeys() {
    const far = SHORT_STEPS + WING_STEPS;
    return [strikeKey(-far), strikeKey(-SHORT_STEPS), strikeKey(SHORT_STEPS), strikeKey(far)];
  },
  isEligible(ctx) {
    if (!EXPIRY_TREND_INDICES.has(ctx.instrument.id)) return false;
    if (!isExpirySessionCtx(ctx)) return false;
    if (!inExpiryTrendWindow(ctx.hour, ctx.minute)) return false;
    return trendDirection(ctx) !== null;
  },
  proposeEntry(ctx) {
    const dir = trendDirection(ctx);
    if (!dir) return null;
    const right: OptionRight = dir === "up" ? "PE" : "CE";
    const away = dir === "up" ? -1 : 1;
    const shortSteps = away * SHORT_STEPS;
    const longSteps = away * (SHORT_STEPS + WING_STEPS);

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
    return buildProposal({
      strategyId: EXPIRY_TREND_ID,
      name: "Expiry Trend Credit",
      bias: dir === "up" ? "Bullish expiry" : "Bearish expiry",
      description: `Expiry ${dir === "up" ? "up" : "down"} from open — sell ${shortStrike}/${longStrike} ${right} credit`,
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
