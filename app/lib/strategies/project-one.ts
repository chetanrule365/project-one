import { proposalCoversCosts } from "./cost-filter";
import { ironCondorStrategy, IC_DEFAULTS } from "./iron-condor";
import { oiRangeFadeStrategy, OI_FADE_DEFAULTS } from "./oi-range-fade";
import { orbAtmStrategy, ORB_DEFAULTS } from "./orb-atm";
import { pmSrReversalStrategy, PM_SR_DEFAULTS } from "./pm-sr-reversal";
import { assertStrategy, settleLegs } from "./common";
import {
  inMorningEntryWindow,
  inPmReversalEntryWindow,
  type EntryContext,
  type OpenPosition,
  type Strategy,
  type TradeProposal,
} from "./types";

export const PROJECT_ONE_ID = "PROJECT_ONE";

function adopt(
  ctx: EntryContext,
  inner: TradeProposal | null,
): TradeProposal | null {
  if (!inner) return null;
  if (!proposalCoversCosts(inner, ctx.instrument.id).ok) return null;
  return {
    ...inner,
    strategyId: PROJECT_ONE_ID,
    name: "Project One",
  };
}

function pickInner(ctx: EntryContext): TradeProposal | null {
  if (inPmReversalEntryWindow(ctx.hour, ctx.minute)) {
    if (!pmSrReversalStrategy.isEligible(ctx)) return null;
    return adopt(ctx, pmSrReversalStrategy.proposeEntry(ctx));
  }
  if (!inMorningEntryWindow(ctx.hour)) return null;

  if (orbAtmStrategy.isEligible(ctx)) {
    const orb = adopt(ctx, orbAtmStrategy.proposeEntry(ctx));
    if (orb) return orb;
  }
  if (oiRangeFadeStrategy.isEligible(ctx)) {
    const fade = adopt(ctx, oiRangeFadeStrategy.proposeEntry(ctx));
    if (fade) return fade;
  }
  if (ironCondorStrategy.isEligible(ctx)) {
    return adopt(ctx, ironCondorStrategy.proposeEntry(ctx));
  }
  return null;
}

export const projectOneStrategy = assertStrategy({
  id: PROJECT_ONE_ID,
  name: "Project One",
  bias: "Regime / sit when there is no edge",
  description:
    "Follow an opening-range break when dealers are chasing. Sell a 2-leg credit only if the credit pays 4× brokerage. Skip cheap iron condors. Afternoon: break S/R, do not fade. Sit out otherwise.",
  requiredStrikeKeys(widthSteps) {
    return [
      ...new Set([
        ...orbAtmStrategy.requiredStrikeKeys(widthSteps),
        ...oiRangeFadeStrategy.requiredStrikeKeys(widthSteps),
        ...ironCondorStrategy.requiredStrikeKeys(widthSteps),
        ...pmSrReversalStrategy.requiredStrikeKeys(widthSteps),
      ]),
    ];
  },
  isEligible(ctx) {
    return (
      inMorningEntryWindow(ctx.hour) ||
      inPmReversalEntryWindow(ctx.hour, ctx.minute)
    );
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

export function projectOneDefaults(input?: {
  credit?: number;
  hour?: number;
}): Partial<OpenPosition> {
  const credit = input?.credit ?? 0;
  const hour = input?.hour ?? 10;
  if (credit < 0 && hour >= 14) return { ...PM_SR_DEFAULTS };
  if (credit < 0) return { ...ORB_DEFAULTS };
  if (credit > 0) return { ...OI_FADE_DEFAULTS };
  return { ...IC_DEFAULTS };
}
