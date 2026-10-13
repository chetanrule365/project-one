import { IC_SPAN_NOTIONAL_FRAC, lotSizeFor } from "../strategies/types";

/** 1-lot capital blocked in ₹ (Dhan-style). */
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
  if (legs >= 4 && input.spot && input.spot > 0) {
    return input.spot * lot * IC_SPAN_NOTIONAL_FRAC;
  }
  return Math.max(0, input.width - input.credit) * lot;
}

function inferLegCount(input: {
  strategyId?: string | null;
  legCount?: number | null;
}) {
  if (input.legCount && input.legCount > 0) return input.legCount;
  if (input.strategyId === "IRON_CONDOR") return 4;
  if (input.strategyId === "PROJECT_ONE") return 4;
  return 2;
}
