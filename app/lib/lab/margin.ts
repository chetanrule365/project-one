import {
  IC_SPAN_NOTIONAL_FRAC,
  NAKED_SPAN_NOTIONAL_FRAC,
  SPREAD_SPAN_NOTIONAL_FRAC,
  lotSizeFor,
} from "../strategies/types";

function spanFrac(legs: number) {
  if (legs >= 4) return IC_SPAN_NOTIONAL_FRAC;
  if (legs <= 1) return NAKED_SPAN_NOTIONAL_FRAC;
  return SPREAD_SPAN_NOTIONAL_FRAC;
}

/** 1-lot capital blocked in ₹ (Dhan Final / Overall Margin). */
export function marginRequiredInr(input: {
  instrumentId?: string | null;
  strategyId?: string | null;
  credit: number;
  width: number;
  spot?: number | null;
  legCount?: number | null;
}): number {
  const lot = lotSizeFor(input.instrumentId ?? "NIFTY");
  if (input.credit < 0) return Math.abs(input.credit) * lot;

  const legs = inferLegCount(input);
  const maxLoss = Math.max(0, input.width - input.credit) * lot;
  const spot = input.spot;
  if (spot && spot > 0) {
    return Math.max(maxLoss, spot * lot * spanFrac(legs));
  }
  return maxLoss;
}

export function inferLegCount(input: {
  strategyId?: string | null;
  legCount?: number | null;
}) {
  if (input.legCount && input.legCount > 0) return input.legCount;
  if (input.strategyId === "IRON_CONDOR") return 4;
  if (input.strategyId === "PROJECT_ONE") return 4;
  return 2;
}
