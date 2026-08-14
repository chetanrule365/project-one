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
import {
  FLAT_BY_HOUR,
  STOP_LOSS_CREDIT_MULT,
  TAKE_PROFIT_FRAC,
  type EntryContext,
  type OpenPosition,
  type Strategy,
} from "./types";

/**
 * Iron Condor — quiet range after morning range forms (~10:00).
 * Short ATM±2, long wings widthSteps further (default 2 ≈ 100 pts).
 * Day-trade: flatten by 14:00 IST on expiry and non-expiry sessions.
 */
export const ironCondorStrategy = assertStrategy({
  id: "IRON_CONDOR",
  name: "Iron Condor",
  bias: "Range / theta",
  description:
    "Sell ATM±2 call & put, buy further OTM wings. Quiet day after morning range; flatten by 14:00.",
  requiredStrikeKeys(widthSteps) {
    const w = Math.max(1, widthSteps);
    return [
      strikeKey(-2 - w),
      strikeKey(-2),
      strikeKey(2),
      strikeKey(2 + w),
    ];
  },
  isEligible(ctx) {
    if (ctx.hour < 10 || ctx.hour >= FLAT_BY_HOUR) return false;
    if (ctx.structure.orbBrokenUp || ctx.structure.orbBrokenDown) return false;
    return ctx.structure.insidePriorRange && ctx.structure.quietDay;
  },
  proposeEntry(ctx) {
    const w = Math.max(1, ctx.widthSteps);
    const callShortKey = strikeKey(2);
    const callLongKey = strikeKey(2 + w);
    const putShortKey = strikeKey(-2);
    const putLongKey = strikeKey(-2 - w);

    if (ctx.rows && ctx.rows.length > 0) {
      const atm = atmIndex(ctx.rows, ctx.spot);
      const cs = ctx.rows[atm + 2];
      const cl = ctx.rows[atm + 2 + w];
      const ps = ctx.rows[atm - 2];
      const pl = ctx.rows[atm - 2 - w];
      if (!cs || !cl || !ps || !pl) return null;
      const csPx = shortPremium(cs.ce);
      const clPx = longPremium(cl.ce);
      const psPx = shortPremium(ps.pe);
      const plPx = longPremium(pl.pe);
      if (
        csPx === null ||
        clPx === null ||
        psPx === null ||
        plPx === null
      ) {
        return null;
      }
      const legs = [
        { right: "CE" as const, strike: cs.strike, strikeKey: callShortKey, qty: -1, premium: csPx },
        { right: "CE" as const, strike: cl.strike, strikeKey: callLongKey, qty: 1, premium: clPx },
        { right: "PE" as const, strike: ps.strike, strikeKey: putShortKey, qty: -1, premium: psPx },
        { right: "PE" as const, strike: pl.strike, strikeKey: putLongKey, qty: 1, premium: plPx },
      ];
      const credit = csPx - clPx + psPx - plPx;
      if (credit <= 0) return null;
      const width = Math.max(cl.strike - cs.strike, ps.strike - pl.strike);
      return buildProposal({
        strategyId: "IRON_CONDOR",
        name: "Iron Condor",
        bias: "Range / theta",
        description: "Iron condor on quiet range",
        legs,
        maxProfit: credit,
        maxLoss: Math.max(0, width - credit),
      });
    }

    const csPx = premiumAt(ctx.premiums, callShortKey, "CE");
    const clPx = premiumAt(ctx.premiums, callLongKey, "CE");
    const psPx = premiumAt(ctx.premiums, putShortKey, "PE");
    const plPx = premiumAt(ctx.premiums, putLongKey, "PE");
    const csK = strikeAt(ctx.strikes, callShortKey);
    const clK = strikeAt(ctx.strikes, callLongKey);
    const psK = strikeAt(ctx.strikes, putShortKey);
    const plK = strikeAt(ctx.strikes, putLongKey);
    if (
      csPx === undefined ||
      clPx === undefined ||
      psPx === undefined ||
      plPx === undefined ||
      csK === undefined ||
      clK === undefined ||
      psK === undefined ||
      plK === undefined
    ) {
      return null;
    }
    const credit = csPx - clPx + psPx - plPx;
    if (credit <= 0) return null;
    const width = Math.max(Math.abs(clK - csK), Math.abs(psK - plK));
    const legs = [
      { right: "CE" as const, strike: csK, strikeKey: callShortKey, qty: -1, premium: csPx },
      { right: "CE" as const, strike: clK, strikeKey: callLongKey, qty: 1, premium: clPx },
      { right: "PE" as const, strike: psK, strikeKey: putShortKey, qty: -1, premium: psPx },
      { right: "PE" as const, strike: plK, strikeKey: putLongKey, qty: 1, premium: plPx },
    ];
    return buildProposal({
      strategyId: "IRON_CONDOR",
      name: "Iron Condor",
      bias: "Range / theta",
        description: "Iron condor on quiet range",
      legs,
      maxProfit: credit,
      maxLoss: Math.max(0, width - credit),
    });
  },
  settle(position: OpenPosition, spot, premiums) {
    return settleLegs(position, spot, premiums);
  },
} satisfies Strategy);

export const IC_DEFAULTS = {
  takeProfitFrac: TAKE_PROFIT_FRAC,
  stopMult: STOP_LOSS_CREDIT_MULT,
  flatByHour: FLAT_BY_HOUR,
};
