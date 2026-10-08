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
import { atStrikeLevel, maxDailyDebitPts, strikeStepPts } from "./expiry-day";
import {
  STOP_LOSS_DEBIT_FRAC,
  TAKE_PROFIT_FRAC,
  inPmReversalEntryWindow,
  PM_REVERSAL_FLAT_HOUR,
  PM_REVERSAL_FLAT_MINUTE,
  type EntryContext,
  type OpenPosition,
  type Strategy,
} from "./types";

export const PM_SR_REVERSAL_ID = "PM_SR_REVERSAL";

function atmStrike(ctx: EntryContext) {
  if (ctx.rows && ctx.rows.length > 0) {
    return ctx.rows[atmIndex(ctx.rows, ctx.spot)]?.strike ?? null;
  }
  const fromMap = strikeAt(ctx.strikes, strikeKey(0));
  if (fromMap !== undefined) return fromMap;
  const step = strikeStepPts(ctx.instrument.id);
  return Math.round(ctx.spot / step) * step;
}

function supportLevels(ctx: EntryContext) {
  return [
    ctx.structure.putOiSupport,
    ctx.structure.priorLow,
    ctx.structure.morningLow,
  ].filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

function resistanceLevels(ctx: EntryContext) {
  return [
    ctx.structure.callOiResistance,
    ctx.structure.priorHigh,
    ctx.structure.morningHigh,
  ].filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

/** Current ATM or spot is on the level (one strike step), right now. */
function taggedNow(ctx: EntryContext, level: number) {
  const atm = atmStrike(ctx);
  if (atm != null && atStrikeLevel(atm, level, ctx.instrument.id)) return true;
  return atStrikeLevel(ctx.spot, level, ctx.instrument.id);
}

function nearestTagged(ctx: EntryContext, levels: number[]) {
  let best: number | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const level of levels) {
    if (!taggedNow(ctx, level)) continue;
    const dist = Math.abs(ctx.spot - level);
    if (dist < bestDist) {
      bestDist = dist;
      best = level;
    }
  }
  return best;
}

export function pmReversalSignal(ctx: EntryContext): {
  direction: "up" | "down";
  level: number;
  kind: "support" | "resistance";
} | null {
  const support = nearestTagged(ctx, supportLevels(ctx));
  const resistance = nearestTagged(ctx, resistanceLevels(ctx));
  if (support == null && resistance == null) return null;
  if (support != null && resistance != null) {
    const ds = Math.abs(ctx.spot - support);
    const dr = Math.abs(ctx.spot - resistance);
    if (Math.abs(ds - dr) < strikeStepPts(ctx.instrument.id) * 0.25) return null;
    return ds < dr
      ? { direction: "up", level: support, kind: "support" }
      : { direction: "down", level: resistance, kind: "resistance" };
  }
  if (support != null) {
    return { direction: "up", level: support, kind: "support" };
  }
  return { direction: "down", level: resistance!, kind: "resistance" };
}

function spreadSteps(ctx: EntryContext) {
  return Math.max(1, ctx.widthSteps || 2);
}

/**
 * Afternoon S/R reversal — 14:00–14:15 IST only.
 * If ATM / spot is on put support or call resistance (or prior / morning S/R),
 * fade: buy ATM call at support, ATM put at resistance. Flatten 15:15.
 */
export const pmSrReversalStrategy = assertStrategy({
  id: PM_SR_REVERSAL_ID,
  name: "Afternoon S/R Reversal",
  bias: "Fade afternoon S/R",
  description:
    "14:00–14:15 IST: if the current strike is on support or resistance, take the reversal (ATM debit spread). Flat by 15:15.",
  requiredStrikeKeys(widthSteps) {
    const steps = Math.max(1, widthSteps);
    return [strikeKey(-steps), strikeKey(0), strikeKey(steps)];
  },
  isEligible(ctx) {
    if (!inPmReversalEntryWindow(ctx.hour, ctx.minute)) return false;
    return pmReversalSignal(ctx) !== null;
  },
  proposeEntry(ctx) {
    const signal = pmReversalSignal(ctx);
    if (!signal) return null;
    const up = signal.direction === "up";
    const right = up ? "CE" : "PE";
    const steps = spreadSteps(ctx);
    const longKey = strikeKey(0);
    const shortKey = strikeKey(up ? steps : -steps);
    const cap = maxDailyDebitPts(ctx.instrument.id);
    const label = signal.kind === "support" ? "support" : "resistance";

    if (ctx.rows && ctx.rows.length > 0) {
      const atm = atmIndex(ctx.rows, ctx.spot);
      const longRow = ctx.rows[atm];
      const shortRow = ctx.rows[atm + (up ? steps : -steps)];
      if (!longRow || !shortRow) return null;
      const longPx = longPremium(right === "CE" ? longRow.ce : longRow.pe);
      const shortPx = shortPremium(right === "CE" ? shortRow.ce : shortRow.pe);
      if (longPx === null || shortPx === null || longPx <= 0 || shortPx <= 0) {
        return null;
      }
      const debit = longPx - shortPx;
      if (debit <= 0 || debit > cap) return null;
      const width = Math.abs(shortRow.strike - longRow.strike);
      return buildProposal({
        strategyId: PM_SR_REVERSAL_ID,
        name: "Afternoon S/R Reversal",
        bias: up ? "Bounce from support" : "Reject from resistance",
        description: `ATM ${right} debit fade ${label} ${Math.round(signal.level)}`,
        legs: [
          {
            right,
            strike: longRow.strike,
            strikeKey: longKey,
            qty: 1,
            premium: longPx,
          },
          {
            right,
            strike: shortRow.strike,
            strikeKey: shortKey,
            qty: -1,
            premium: shortPx,
          },
        ],
        maxProfit: Math.max(0, width - debit),
        maxLoss: debit,
      });
    }

    const longPx = premiumAt(ctx.premiums, longKey, right);
    const shortPx = premiumAt(ctx.premiums, shortKey, right);
    const longStrike = strikeAt(ctx.strikes, longKey);
    const shortStrike = strikeAt(ctx.strikes, shortKey);
    if (
      longPx === undefined ||
      shortPx === undefined ||
      longPx <= 0 ||
      shortPx <= 0 ||
      longStrike === undefined ||
      shortStrike === undefined
    ) {
      return null;
    }
    const debit = longPx - shortPx;
    if (debit <= 0 || debit > cap) return null;
    const width = Math.abs(shortStrike - longStrike);
    return buildProposal({
      strategyId: PM_SR_REVERSAL_ID,
      name: "Afternoon S/R Reversal",
      bias: up ? "Bounce from support" : "Reject from resistance",
      description: `ATM ${right} debit fade ${label} ${Math.round(signal.level)}`,
      legs: [
        { right, strike: longStrike, strikeKey: longKey, qty: 1, premium: longPx },
        { right, strike: shortStrike, strikeKey: shortKey, qty: -1, premium: shortPx },
      ],
      maxProfit: Math.max(0, width - debit),
      maxLoss: debit,
    });
  },
  settle(position: OpenPosition, spot, premiums) {
    return settleLegs(position, spot, premiums);
  },
} satisfies Strategy);

export const PM_SR_DEFAULTS = {
  stopMult: STOP_LOSS_DEBIT_FRAC,
  takeProfitFrac: TAKE_PROFIT_FRAC,
  flatByHour: PM_REVERSAL_FLAT_HOUR,
  flatByMinute: PM_REVERSAL_FLAT_MINUTE,
};

export function isPmSrReversal(strategyId: string) {
  return strategyId === PM_SR_REVERSAL_ID;
}
