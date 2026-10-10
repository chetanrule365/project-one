import type { TradeProposal } from "./types";
import { lotSizeFor } from "./types";

/** Dhan F&O: ₹20 per executed order. Entry + exit counted for each leg. */
export const DHAN_FNO_BROKERAGE_PER_ORDER = 20;

/** Skip unless expected max remaining premium covers this many round trips. */
export const MIN_EV_COST_MULT = 4;

export function roundTripBrokerageInr(legCount: number) {
  return Math.max(1, legCount) * 2 * DHAN_FNO_BROKERAGE_PER_ORDER;
}

export function minCoverPts(instrumentId: string, legCount: number) {
  const lot = lotSizeFor(instrumentId);
  return (roundTripBrokerageInr(legCount) * MIN_EV_COST_MULT) / lot;
}

export function proposalCoversCosts(
  proposal: TradeProposal,
  instrumentId: string,
): { ok: boolean; reason?: string; brokerageInr: number; minPts: number } {
  const brokerageInr = roundTripBrokerageInr(proposal.legs.length);
  const minPts = minCoverPts(instrumentId, proposal.legs.length);
  const coverPts =
    proposal.netCredit > 0
      ? proposal.netCredit
      : Math.max(proposal.maxProfit, 0);

  if (coverPts + 1e-9 < minPts) {
    const kind = proposal.netCredit > 0 ? "Credit" : "Max profit";
    return {
      ok: false,
      brokerageInr,
      minPts,
      reason: `${kind} ${coverPts.toFixed(1)} pts < ${minPts.toFixed(1)} pts min (${MIN_EV_COST_MULT}× brokerage ₹${brokerageInr})`,
    };
  }
  return { ok: true, brokerageInr, minPts };
}
