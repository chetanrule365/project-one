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
import {
  NO_LONG_AFTER_HOUR,
  STOP_LOSS_DEBIT_FRAC,
  type EntryContext,
  type OpenPosition,
  type Strategy,
} from "./types";

/**
 * Opening Range Breakout — buy ATM CE/PE on clean break (hourly proxy).
 */
export const orbAtmStrategy = assertStrategy({
  id: "ORB_ATM",
  name: "ORB ATM Buy",
  bias: "Directional (morning)",
  description:
    "Buy ATM call/put on opening-range break. Hourly proxy for 9:15–9:30 ORB.",
  requiredStrikeKeys() {
    return [strikeKey(0)];
  },
  isEligible(ctx) {
    if (ctx.hour < 10 || ctx.hour >= NO_LONG_AFTER_HOUR) return false;
    return ctx.structure.orbBrokenUp || ctx.structure.orbBrokenDown;
  },
  proposeEntry(ctx) {
    const up = ctx.structure.orbBrokenUp;
    const down = ctx.structure.orbBrokenDown;
    if (up === down) return null;
    const right = up ? "CE" : "PE";
    const key = strikeKey(0);

    if (ctx.rows && ctx.rows.length > 0) {
      const atm = atmIndex(ctx.rows, ctx.spot);
      const row = ctx.rows[atm];
      if (!row) return null;
      const side = right === "CE" ? row.ce : row.pe;
      const px = longPremium(side);
      if (px === null || px <= 0) return null;
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
    if (px === undefined || px <= 0 || strike === undefined) return null;
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
  flatByHour: NO_LONG_AFTER_HOUR,
};
