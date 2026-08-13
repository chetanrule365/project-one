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
import { maxExpiryDebitPts, orbFightsMaxPain } from "./expiry-day";
import {
  ORB_ENTRY_UNTIL_HOUR,
  STOP_LOSS_DEBIT_FRAC,
  type EntryContext,
  type OpenPosition,
  type Strategy,
} from "./types";

/**
 * Opening Range Breakout — buy ATM CE/PE only on a clean, expensive-to-fade break.
 * Auto playbook ranks this after premium-selling on expiry.
 */
export const orbAtmStrategy = assertStrategy({
  id: "ORB_ATM",
  name: "ORB ATM Buy",
  bias: "Directional (morning)",
  description:
    "Buy ATM only on a one-sided break vs open, not on quiet/chop days, and not against max pain. Skip rich expiry premium.",
  requiredStrikeKeys() {
    return [strikeKey(0)];
  },
  isEligible(ctx) {
    if (ctx.hour < 10 || ctx.hour >= ORB_ENTRY_UNTIL_HOUR) return false;
    if (ctx.structure.quietDay) return false;
    const up = ctx.structure.orbBrokenUp;
    const down = ctx.structure.orbBrokenDown;
    if (up === down) return false;
    if (orbFightsMaxPain(ctx.structure, up ? "up" : "down")) return false;
    return true;
  },
  proposeEntry(ctx) {
    const up = ctx.structure.orbBrokenUp;
    const down = ctx.structure.orbBrokenDown;
    if (up === down) return null;
    const right = up ? "CE" : "PE";
    const key = strikeKey(0);
    const cap = maxExpiryDebitPts(ctx.instrument.id);

    if (ctx.rows && ctx.rows.length > 0) {
      const atm = atmIndex(ctx.rows, ctx.spot);
      const row = ctx.rows[atm];
      if (!row) return null;
      const side = right === "CE" ? row.ce : row.pe;
      const px = longPremium(side);
      if (px === null || px <= 0 || px > cap) return null;
      return buildProposal({
        strategyId: "ORB_ATM",
        name: "ORB ATM Buy",
        bias: up ? "Bullish breakout" : "Bearish breakout",
        description: `ATM ${right} on ORB ${up ? "up" : "down"}`,
        legs: [
          {
            right,
            strike: row.strike,
            strikeKey: key,
            qty: 1,
            premium: px,
          },
        ],
        maxProfit: px * 3,
        maxLoss: px,
      });
    }

    const px = premiumAt(ctx.premiums, key, right);
    const strike = strikeAt(ctx.strikes, key);
    if (px === undefined || px <= 0 || px > cap || strike === undefined) {
      return null;
    }
    return buildProposal({
      strategyId: "ORB_ATM",
      name: "ORB ATM Buy",
      bias: up ? "Bullish breakout" : "Bearish breakout",
      description: `ATM ${right} on ORB ${up ? "up" : "down"}`,
      legs: [{ right, strike, strikeKey: key, qty: 1, premium: px }],
      maxProfit: px * 3,
      maxLoss: px,
    });
  },
  settle(position: OpenPosition, spot, premiums) {
    return settleLegs(position, spot, premiums);
  },
} satisfies Strategy);

export const ORB_DEFAULTS = {
  stopMult: STOP_LOSS_DEBIT_FRAC,
  timeStopHours: 1,
  flatByHour: ORB_ENTRY_UNTIL_HOUR,
};
