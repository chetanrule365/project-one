import {
  assertStrategy,
  atmIndex,
  buildProposal,
  longPremium,
  premiumAt,
  settleLegs,
  strikeAt,
  strikeKey,
} from "./common";
import { inMaxPainBand, isExpirySessionCtx, maxExpiryDebitPts } from "./expiry-day";
import {
  FLAT_BY_HOUR,
  STOP_LOSS_DEBIT_FRAC,
  type EntryContext,
  type OpenPosition,
  type Strategy,
} from "./types";

/**
 * Max-pain mean reversion — ATM directional buy toward max pain.
 */
export const maxPainStrategy = assertStrategy({
  id: "MAX_PAIN_REV",
  name: "Max Pain Reversion",
  bias: "Mean reversion",
  description:
  description: "When spot is 80–200 pts from max pain on a non-breakout day, buy ATM toward max pain.",
  requiredStrikeKeys() {
    return [strikeKey(0)];
  },
  isEligible(ctx) {
    if (!isExpirySessionCtx(ctx)) return false;
    if (ctx.hour < 10 || ctx.hour >= FLAT_BY_HOUR) return false;
    if (ctx.structure.orbBrokenUp || ctx.structure.orbBrokenDown) return false;
    return inMaxPainBand(ctx.structure.distToMaxPain);
  },
  proposeEntry(ctx) {
    const dist = ctx.structure.distToMaxPain;
    const maxPain = ctx.structure.maxPain;
    if (dist === null || maxPain === null) return null;
    // Above max pain → buy puts; below → buy calls
    const right = dist > 0 ? "PE" : "CE";
    const key = strikeKey(0);
    const halfway = ctx.spot - dist / 2;

    if (ctx.rows && ctx.rows.length > 0) {
      const atm = atmIndex(ctx.rows, ctx.spot);
      const row = ctx.rows[atm];
      if (!row) return null;
      const side = right === "CE" ? row.ce : row.pe;
      const px = longPremium(side);
      if (px === null || px <= 0) return null;
      if (px > maxExpiryDebitPts(ctx.instrument.id)) return null;
      const proposal = buildProposal({
        strategyId: "MAX_PAIN_REV",
        name: "Max Pain Reversion",
        bias: right === "PE" ? "Fade up toward max pain" : "Fade down toward max pain",
        description: `ATM ${right} toward max pain ${maxPain}`,
        legs: [
          { right, strike: row.strike, strikeKey: key, qty: 1, premium: px },
        ],
        maxProfit: Math.abs(dist) / 2,
        maxLoss: px,
      });
      return proposal;
    }

    const px = premiumAt(ctx.premiums, key, right);
    const strike = strikeAt(ctx.strikes, key);
    if (px === undefined || px <= 0 || strike === undefined) return null;
    if (px > maxExpiryDebitPts(ctx.instrument.id)) return null;
    void halfway;
    return buildProposal({
      strategyId: "MAX_PAIN_REV",
      name: "Max Pain Reversion",
      bias: right === "PE" ? "Fade up toward max pain" : "Fade down toward max pain",
      description: `ATM ${right} toward max pain ${maxPain}`,
      legs: [{ right, strike, strikeKey: key, qty: 1, premium: px }],
      maxProfit: Math.abs(dist) / 2,
      maxLoss: px,
    });
  },
  settle(position: OpenPosition, spot, premiums) {
    return settleLegs(position, spot, premiums);
  },
} satisfies Strategy);

export function maxPainTargets(ctx: EntryContext) {
  const dist = ctx.structure.distToMaxPain;
  const maxPain = ctx.structure.maxPain;
  if (dist === null || maxPain === null) return null;
  return {
    targetSpot: ctx.spot - dist / 2,
    stopSpot: ctx.spot + Math.sign(dist) * 50,
  };
}

export const MAX_PAIN_DEFAULTS = {
  stopMult: STOP_LOSS_DEBIT_FRAC,
  flatByHour: FLAT_BY_HOUR,
};
