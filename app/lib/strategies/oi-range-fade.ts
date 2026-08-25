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
import { nearLevelFor } from "./expiry-day";
import {
  FLAT_BY_HOUR,
  STOP_LOSS_CREDIT_MULT,
  TAKE_PROFIT_FRAC,
  type EntryContext,
  type OpenPosition,
  type Strategy,
} from "./types";

/**
 * OI range fade — credit spread near put OI support / call OI resistance.
 */
export const oiRangeFadeStrategy = assertStrategy({
  id: "OI_RANGE_FADE",
  name: "OI Range Fade",
  bias: "Fade OI walls",
  description:
    "Any session: near put-OI support → bull put; near call-OI resistance → bear call. Defined-risk credit.",
  requiredStrikeKeys(widthSteps) {
    const w = Math.max(1, widthSteps);
    return [strikeKey(-1), strikeKey(-1 - w), strikeKey(1), strikeKey(1 + w)];
  },
  isEligible(ctx) {
    if (ctx.hour < 10 || ctx.hour >= FLAT_BY_HOUR) return false;
    if (ctx.structure.orbBrokenUp || ctx.structure.orbBrokenDown) return false;
    const nearPut = nearLevelFor(ctx.spot, ctx.structure.putOiSupport, ctx.instrument.id);
    const nearCall = nearLevelFor(ctx.spot, ctx.structure.callOiResistance, ctx.instrument.id);
    return nearPut || nearCall;
  },
  proposeEntry(ctx) {
    const w = Math.max(1, ctx.widthSteps);
    const nearPut = nearLevelFor(ctx.spot, ctx.structure.putOiSupport, ctx.instrument.id);
    const nearCall = nearLevelFor(ctx.spot, ctx.structure.callOiResistance, ctx.instrument.id);
    if (nearPut === nearCall) return null;

    if (nearPut) {
      const shortKey = strikeKey(-1);
      const longKey = strikeKey(-1 - w);
      if (ctx.rows && ctx.rows.length > 0) {
        const atm = atmIndex(ctx.rows, ctx.spot);
        const s = ctx.rows[atm - 1];
        const l = ctx.rows[atm - 1 - w];
        if (!s || !l) return null;
        const sPx = shortPremium(s.pe);
        const lPx = longPremium(l.pe);
        if (sPx === null || lPx === null) return null;
        const credit = sPx - lPx;
        if (credit <= 0) return null;
        const width = s.strike - l.strike;
        return buildProposal({
          strategyId: "OI_RANGE_FADE",
          name: "OI Range Fade",
          bias: "Bullish at put OI support",
          description: `Bull put near put OI ${ctx.structure.putOiSupport}`,
          legs: [
            { right: "PE", strike: s.strike, strikeKey: shortKey, qty: -1, premium: sPx },
            { right: "PE", strike: l.strike, strikeKey: longKey, qty: 1, premium: lPx },
          ],
          maxProfit: credit,
          maxLoss: Math.max(0, width - credit),
        });
      }
      const sPx = premiumAt(ctx.premiums, shortKey, "PE");
      const lPx = premiumAt(ctx.premiums, longKey, "PE");
      const sK = strikeAt(ctx.strikes, shortKey);
      const lK = strikeAt(ctx.strikes, longKey);
      if (
        sPx === undefined ||
        lPx === undefined ||
        sK === undefined ||
        lK === undefined
      ) {
        return null;
      }
      const credit = sPx - lPx;
      if (credit <= 0) return null;
      return buildProposal({
        strategyId: "OI_RANGE_FADE",
        name: "OI Range Fade",
        bias: "Bullish at put OI support",
        description: `Bull put near put OI ${ctx.structure.putOiSupport}`,
        legs: [
          { right: "PE", strike: sK, strikeKey: shortKey, qty: -1, premium: sPx },
          { right: "PE", strike: lK, strikeKey: longKey, qty: 1, premium: lPx },
        ],
        maxProfit: credit,
        maxLoss: Math.max(0, Math.abs(sK - lK) - credit),
      });
    }

    // near call resistance → bear call
    const shortKey = strikeKey(1);
    const longKey = strikeKey(1 + w);
    if (ctx.rows && ctx.rows.length > 0) {
      const atm = atmIndex(ctx.rows, ctx.spot);
      const s = ctx.rows[atm + 1];
      const l = ctx.rows[atm + 1 + w];
      if (!s || !l) return null;
      const sPx = shortPremium(s.ce);
      const lPx = longPremium(l.ce);
      if (sPx === null || lPx === null) return null;
      const credit = sPx - lPx;
      if (credit <= 0) return null;
      return buildProposal({
        strategyId: "OI_RANGE_FADE",
        name: "OI Range Fade",
        bias: "Bearish at call OI resistance",
        description: `Bear call near call OI ${ctx.structure.callOiResistance}`,
        legs: [
          { right: "CE", strike: s.strike, strikeKey: shortKey, qty: -1, premium: sPx },
          { right: "CE", strike: l.strike, strikeKey: longKey, qty: 1, premium: lPx },
        ],
        maxProfit: credit,
        maxLoss: Math.max(0, l.strike - s.strike - credit),
      });
    }
    const sPx = premiumAt(ctx.premiums, shortKey, "CE");
    const lPx = premiumAt(ctx.premiums, longKey, "CE");
    const sK = strikeAt(ctx.strikes, shortKey);
    const lK = strikeAt(ctx.strikes, longKey);
    if (
      sPx === undefined ||
      lPx === undefined ||
      sK === undefined ||
      lK === undefined
    ) {
      return null;
    }
    const credit = sPx - lPx;
    if (credit <= 0) return null;
    return buildProposal({
      strategyId: "OI_RANGE_FADE",
      name: "OI Range Fade",
      bias: "Bearish at call OI resistance",
      description: `Bear call near call OI ${ctx.structure.callOiResistance}`,
      legs: [
        { right: "CE", strike: sK, strikeKey: shortKey, qty: -1, premium: sPx },
        { right: "CE", strike: lK, strikeKey: longKey, qty: 1, premium: lPx },
      ],
      maxProfit: credit,
      maxLoss: Math.max(0, Math.abs(lK - sK) - credit),
    });
  },
  settle(position: OpenPosition, spot, premiums) {
    return settleLegs(position, spot, premiums);
  },
} satisfies Strategy);

export const OI_FADE_DEFAULTS = {
  takeProfitFrac: TAKE_PROFIT_FRAC,
  stopMult: STOP_LOSS_CREDIT_MULT,
  flatByHour: FLAT_BY_HOUR,
};
