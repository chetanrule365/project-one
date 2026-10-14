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
  isExpirySessionCtx,
  maxDebitPts,
  orbFightsMaxPain,
} from "./expiry-day";
import {
  inOrbWindow,
  ORB_FLAT_BY_HOUR,
  STOP_LOSS_DEBIT_FRAC,
  type EntryContext,
  type OpenPosition,
  type Strategy,
} from "./types";

const ORB_SPREAD_STEPS = 2;

/**
 * Opening Range Breakout.
 * Expiry: buy ATM if premium is cheap.
 * Other weekdays: ATM debit spread so time value does not blow the debit cap.
 */
export const orbAtmStrategy = assertStrategy({
  id: "ORB_ATM",
  name: "ORB ATM Buy",
  bias: "Directional (morning)",
  description:
    "Buy a one-sided break vs open, not on quiet/chop days. Expiry: ATM if cheap. Other days: ATM debit spread. Skip if fighting expiry max-pain pin.",
  requiredStrikeKeys() {
    return [strikeKey(-ORB_SPREAD_STEPS), strikeKey(0), strikeKey(ORB_SPREAD_STEPS)];
  },
  isEligible(ctx) {
    if (!inOrbWindow(ctx.hour, ctx.minute, ctx.orbWindow)) return false;
    // Quiet/chop is encoded in orb flags (one-sided break vs open). Do not
    // also require prior-day quietDay — that blocked almost all backtest ORBs.
    const up = ctx.structure.orbBrokenUp;
    const down = ctx.structure.orbBrokenDown;
    if (up === down) return false;
    if (
      isExpirySessionCtx(ctx) &&
      orbFightsMaxPain(ctx.structure, up ? "up" : "down")
    ) {
      return false;
    }
    return true;
  },
  proposeEntry(ctx) {
    const up = ctx.structure.orbBrokenUp;
    const down = ctx.structure.orbBrokenDown;
    if (up === down) return null;
    if (ctx.orbWindow?.side === "sell") {
      return proposeOrbCredit(ctx, up ? "up" : "down", ctx.orbWindow.shortOffsetSteps ?? 0);
    }
    const right = up ? "CE" : "PE";
    const longKey = strikeKey(0);
    const expiry = isExpirySessionCtx(ctx);
    const cap = maxDebitPts(ctx.instrument.id, expiry);

    if (ctx.rows && ctx.rows.length > 0) {
      const atm = atmIndex(ctx.rows, ctx.spot);
      const longRow = ctx.rows[atm];
      if (!longRow) return null;
      const longSide = right === "CE" ? longRow.ce : longRow.pe;
      const longPx = longPremium(longSide);
      if (longPx === null || longPx <= 0) return null;

      if (expiry) {
        if (longPx > cap) return null;
        return buildProposal({
          strategyId: "ORB_ATM",
          name: "ORB ATM Buy",
          bias: up ? "Bullish breakout" : "Bearish breakout",
          description: `ATM ${right} on ORB ${up ? "up" : "down"}`,
          legs: [
            {
              right,
              strike: longRow.strike,
              strikeKey: longKey,
              qty: 1,
              premium: longPx,
            },
          ],
          maxProfit: longPx * 3,
          maxLoss: longPx,
        });
      }

      const shortRow = ctx.rows[atm + (up ? ORB_SPREAD_STEPS : -ORB_SPREAD_STEPS)];
      if (!shortRow) return null;
      const shortSide = right === "CE" ? shortRow.ce : shortRow.pe;
      const shortPx = shortPremium(shortSide);
      if (shortPx === null || shortPx <= 0) return null;
      const debit = longPx - shortPx;
      if (debit <= 0 || debit > cap) return null;
      const width = Math.abs(shortRow.strike - longRow.strike);
      return buildProposal({
        strategyId: "ORB_ATM",
        name: "ORB ATM Buy",
        bias: up ? "Bullish breakout" : "Bearish breakout",
        description: `ATM ${right} debit spread on ORB ${up ? "up" : "down"}`,
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
            strikeKey: strikeKey(up ? ORB_SPREAD_STEPS : -ORB_SPREAD_STEPS),
            qty: -1,
            premium: shortPx,
          },
        ],
        maxProfit: Math.max(0, width - debit),
        maxLoss: debit,
      });
    }

    const longPx = premiumAt(ctx.premiums, longKey, right);
    const longStrike = strikeAt(ctx.strikes, longKey);
    if (longPx === undefined || longPx <= 0 || longStrike === undefined) {
      return null;
    }

    if (expiry) {
      if (longPx > cap) return null;
      return buildProposal({
        strategyId: "ORB_ATM",
        name: "ORB ATM Buy",
        bias: up ? "Bullish breakout" : "Bearish breakout",
        description: `ATM ${right} on ORB ${up ? "up" : "down"}`,
        legs: [{ right, strike: longStrike, strikeKey: longKey, qty: 1, premium: longPx }],
        maxProfit: longPx * 3,
        maxLoss: longPx,
      });
    }

    const shortKey = strikeKey(up ? ORB_SPREAD_STEPS : -ORB_SPREAD_STEPS);
    const shortPx = premiumAt(ctx.premiums, shortKey, right);
    const shortStrike = strikeAt(ctx.strikes, shortKey);
    if (shortPx === undefined || shortPx <= 0 || shortStrike === undefined) {
      return null;
    }
    const debit = longPx - shortPx;
    if (debit <= 0 || debit > cap) return null;
    const width = Math.abs(shortStrike - longStrike);
    return buildProposal({
      strategyId: "ORB_ATM",
      name: "ORB ATM Buy",
      bias: up ? "Bullish breakout" : "Bearish breakout",
      description: `ATM ${right} debit spread on ORB ${up ? "up" : "down"}`,
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

/** Up-break: bull put spread. Down-break: bear call spread. Short sits `offset` steps OTM. */
function proposeOrbCredit(ctx: EntryContext, dir: "up" | "down", offset: number) {
  const right = dir === "up" ? "PE" : "CE";
  const away = dir === "up" ? -1 : 1;
  const shortSteps = away * offset;
  const longSteps = away * (offset + ORB_SPREAD_STEPS);

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
    strategyId: "ORB_ATM",
    name: "ORB Credit Spread",
    bias: dir === "up" ? "Bullish breakout" : "Bearish breakout",
    description: `Sell ${right} credit spread on ORB ${dir}`,
    legs: [
      { right, strike: shortStrike, strikeKey: strikeKey(shortSteps), qty: -1, premium: shortPx },
      { right, strike: longStrike, strikeKey: strikeKey(longSteps), qty: 1, premium: longPx },
    ],
    maxProfit: credit,
    maxLoss: Math.max(0, width - credit),
  });
}

export const ORB_DEFAULTS = {
  stopMult: STOP_LOSS_DEBIT_FRAC,
  takeProfitFrac: 1,
  flatByHour: ORB_FLAT_BY_HOUR,
};
