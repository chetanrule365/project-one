import { positionDefaults } from "../strategies/registry";
import { FLAT_BY_HOUR } from "../strategies/types";
import { isIstTradingWeekday, normalizeExpiryDay } from "../strategies/expiry-day";

export type PaperExitDecision = {
  pnlPoints: number;
  reason: string;
};

/**
 * Live paper exit: stop, time-stop, take-profit, then flatten.
 * Morning credits flatten at 14:00 so the afternoon reversal can use the slot.
 * Afternoon reversal flats at 15:15.
 */
export function decidePaperExit(input: {
  strategyId: string;
  hour: number;
  minute?: number;
  today: string;
  expiryAt: string;
  credit: number;
  pnlPoints: number;
  entryHour?: number | null;
  expirySession?: boolean;
}): PaperExitDecision | null {
  const expiryDay = normalizeExpiryDay(input.expiryAt);
  const pastExpiry = input.today > expiryDay;
  const expirySession =
    input.expirySession ?? (input.today === expiryDay || pastExpiry);
  const defaults = positionDefaults(input.strategyId, expirySession, {
    credit: input.credit,
    hour: input.entryHour ?? input.hour,
  });
  const minute = input.minute ?? 0;

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

  const tpFrac = defaults.takeProfitFrac;
  if (tpFrac && input.pnlPoints >= risk * tpFrac) {
    return { pnlPoints: input.pnlPoints, reason: "Take profit 60%" };
  }

  const flatHour = defaults.flatByHour ?? FLAT_BY_HOUR;
  const flatMinute = defaults.flatByMinute ?? 0;
  const flattened =
    input.hour > flatHour || (input.hour === flatHour && minute >= flatMinute);
  if (pastExpiry || flattened) {
    const clock =
      flatMinute > 0
        ? `${flatHour}:${String(flatMinute).padStart(2, "0")}`
        : `${flatHour}:00`;
    return {
      pnlPoints: input.pnlPoints,
      reason: pastExpiry ? "Past expiry" : `Flat by ${clock}`,
    };
  }

  return null;
}
