import { positionDefaults } from "../strategies/registry";
import { FLAT_BY_HOUR } from "../strategies/types";
import { isIstTradingWeekday, normalizeExpiryDay } from "../strategies/expiry-day";

export type PaperExitDecision = {
  pnlPoints: number;
  reason: string;
};

/**
 * Live paper exit: stop, ORB time-stop, take-profit, then flatten.
 * Expiry credits flatten at 14:00; other days at 15:00.
 */
export function decidePaperExit(input: {
  strategyId: string;
  hour: number;
  today: string;
  expiryAt: string;
  credit: number;
  pnlPoints: number;
  entryHour?: number | null;
}): PaperExitDecision | null {
  const expiryDay = normalizeExpiryDay(input.expiryAt);
  const pastExpiry = input.today > expiryDay;
  const expirySession = input.today === expiryDay || pastExpiry;
  const defaults = positionDefaults(input.strategyId, expirySession);

  const isDebit = input.credit < 0;
  const risk = Math.abs(input.credit) || 1;
  const stopLevel = isDebit
    ? -risk * (defaults.stopMult ?? 0.35)
    : -risk * (defaults.stopMult ?? 2);

  if (input.pnlPoints <= stopLevel) {
    return { pnlPoints: stopLevel, reason: "Stop" };
  }

  if (!isIstTradingWeekday(input.today)) {
    return { pnlPoints: input.pnlPoints, reason: "Weekend flatten" };
  }

  const timedOut =
    defaults.timeStopHours !== undefined &&
    input.entryHour !== undefined &&
    input.entryHour !== null &&
    input.hour >= input.entryHour + defaults.timeStopHours;
  if (timedOut) {
    return { pnlPoints: input.pnlPoints, reason: "Time stop" };
  }

  const flatHour = defaults.flatByHour ?? (expirySession ? FLAT_BY_HOUR : 15);
  if (pastExpiry || input.hour >= flatHour) {
    return {
      pnlPoints: input.pnlPoints,
      reason: pastExpiry ? "Past expiry" : `Flat by ${flatHour}:00`,
    };
  }

  const tpFrac = defaults.takeProfitFrac;
  if (!isDebit && tpFrac && input.credit > 0) {
    const tpLevel = input.credit * tpFrac;
    if (input.pnlPoints >= tpLevel) {
      return { pnlPoints: input.pnlPoints, reason: "Take profit 60%" };
    }
  }

  return null;
}
