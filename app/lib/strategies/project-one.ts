import { proposalCoversCosts } from "./cost-filter";
import { daysToExpiry, isMonthlyExpiryIndex } from "./expiry-day";
import { ironCondorStrategy, IC_DEFAULTS } from "./iron-condor";
import { oiRangeFadeStrategy, OI_FADE_DEFAULTS } from "./oi-range-fade";
import { assertStrategy, settleLegs } from "./common";
import {
  inMorningEntryWindow,
  type EntryContext,
  type OpenPosition,
  type Strategy,
  type TradeProposal,
} from "./types";

export const PROJECT_ONE_ID = "PROJECT_ONE";

function noTrend(ctx: EntryContext) {
  return !ctx.structure.orbBrokenUp && !ctx.structure.orbBrokenDown;
}

function quietRange(ctx: EntryContext) {
  return (
    noTrend(ctx) &&
    ctx.structure.insidePriorRange &&
    ctx.structure.quietDay
  );
}

function sessionDte(ctx: EntryContext) {
  if (ctx.expirySession === true) return 0;
  const cal = daysToExpiry(ctx.instrument.id, ctx.structure.day);
  // Caller marked this as a non-expiry session (holiday/test) even on the
  // calendar weekday — don't treat it as 0DTE.
  if (ctx.expirySession === false && cal === 0) return 2;
  return cal;
}

function adopt(
  ctx: EntryContext,
  inner: TradeProposal | null,
  why: string,
): TradeProposal | null {
  if (!inner) return null;
  if (inner.netCredit <= 0) return null;
  if (!proposalCoversCosts(inner, ctx.instrument.id).ok) return null;
  return {
    ...inner,
    strategyId: PROJECT_ONE_ID,
    name: "Project One",
    description: why,
  };
}

function pickInner(ctx: EntryContext): TradeProposal | null {
  if (!inMorningEntryWindow(ctx.hour)) return null;
  if (!noTrend(ctx)) return null;
  const dte = sessionDte(ctx);

  if (dte === 0) {
    const condor = adopt(
      ctx,
      ironCondorStrategy.proposeEntry(ctx),
      "Expiry iron condor — sell theta, flatten 15:00",
    );
    if (condor) return condor;
    if (oiRangeFadeStrategy.isEligible(ctx)) {
      return adopt(
        ctx,
        oiRangeFadeStrategy.proposeEntry(ctx),
        "Expiry OI credit — fade the wall, flatten 15:00",
      );
    }
    return null;
  }

  if (dte === 1) {
    if (quietRange(ctx) || ironCondorStrategy.isEligible(ctx)) {
      const condor = adopt(
        ctx,
        ironCondorStrategy.proposeEntry(ctx),
        "Day-before iron condor — still decaying",
      );
      if (condor) return condor;
    }
    // Day-before single-side fades only on quiet range days — avoids selling
    // puts into an already-soft tape just because an OI wall is nearby.
    if (quietRange(ctx) && oiRangeFadeStrategy.isEligible(ctx)) {
      return adopt(
        ctx,
        oiRangeFadeStrategy.proposeEntry(ctx),
        "Day-before OI credit",
      );
    }
    return null;
  }

  if (isMonthlyExpiryIndex(ctx.instrument.id)) return null;
  if (!quietRange(ctx) || !ironCondorStrategy.isEligible(ctx)) return null;
  return adopt(
    ctx,
    ironCondorStrategy.proposeEntry(ctx),
    "Quiet-day iron condor — range + no ORB break",
  );
}

export const projectOneStrategy = assertStrategy({
  id: PROJECT_ONE_ID,
  name: "Project One",
  bias: "Credit theta / sit trend days",
  description:
    "Sell credits only: expiry + day-before (Bank Nifty: last Tuesday of the month). Quiet iron condors on Nifty/Sensex. Flat 14:00 normally, 15:00 on expiry. Never buy premium.",
  requiredStrikeKeys(widthSteps) {
    return [
      ...new Set([
        ...ironCondorStrategy.requiredStrikeKeys(widthSteps),
        ...oiRangeFadeStrategy.requiredStrikeKeys(widthSteps),
      ]),
    ];
  },
  isEligible(ctx) {
    if (!inMorningEntryWindow(ctx.hour) || !noTrend(ctx)) return false;
    const dte = sessionDte(ctx);
    if (dte === 0 || dte === 1) return true;
    if (isMonthlyExpiryIndex(ctx.instrument.id)) return false;
    return quietRange(ctx);
  },
  proposeEntry(ctx) {
    return pickInner(ctx);
  },
  settle(position: OpenPosition, spot, premiums) {
    return settleLegs(position, spot, premiums);
  },
} satisfies Strategy);

export function isProjectOne(strategyId: string) {
  return (
    strategyId === PROJECT_ONE_ID ||
    strategyId === "AUTO" ||
    strategyId === "BOTH"
  );
}

/** Expiry credits keep decaying into the afternoon; non-expiry still flats 14:00. */
export const PROJECT_ONE_EXPIRY_FLAT_HOUR = 15;

export function projectOneDefaults(input?: {
  credit?: number;
  hour?: number;
  expirySession?: boolean;
}): Partial<OpenPosition> {
  const base =
    (input?.credit ?? 0) > 0 ? { ...OI_FADE_DEFAULTS } : { ...IC_DEFAULTS };
  if (input?.expirySession) {
    return {
      ...base,
      flatByHour: PROJECT_ONE_EXPIRY_FLAT_HOUR,
      flatByMinute: 0,
    };
  }
  return base;
}
