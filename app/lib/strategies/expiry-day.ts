import type { OptionChainRow } from "../dhan/option-chain";
import type { RollingBar } from "../dhan/rolling-options";
import {
  LIVE_QUIET_RANGE_PCT,
  MAX_DAILY_DEBIT_PTS,
  MAX_EXPIRY_DEBIT_PTS,
  MAX_PAIN_MAX_DIST,
  MAX_PAIN_MIN_DIST,
  ORB_BREAK_PCT,
  ORB_HOURS,
  ORB_MIN_BREAK_PTS,
  QUIET_PRIOR_RANGE_PCT,
  type DayStructure,
  type EntryContext,
} from "./types";
import { atmIndex, strikeKey } from "./common";

/** IST calendar day + hour from unix seconds. */
export function istParts(timestampSec: number) {
  const d = new Date(timestampSec * 1000);
  const day = d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const hour = Number(
    d.toLocaleTimeString("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      hour12: false,
    }).slice(0, 2),
  );
  return { day, hour };
}

export function istWeekday(day: string) {
  return new Date(`${day}T12:00:00+05:30`).getDay();
}

/**
 * Weekly expiry weekday (IST).
 * Nifty: Tuesday. Sensex: Thursday. BankNifty: last Tuesday (monthly) — treat Tuesday.
 */
export function expiryWeekday(instrumentId: string) {
  if (instrumentId === "SENSEX") return 4; // Thursday
  return 2; // Tuesday — Nifty & BankNifty
}

export function todayIst() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** Mon–Fri in IST. Holidays are not in the calendar; callers sit out if the chain is dead. */
export function isIstTradingWeekday(day: string) {
  const weekday = istWeekday(day);
  return weekday >= 1 && weekday <= 5;
}

/** Dhan expiry list items are typically YYYY-MM-DD. */
export function expiryEqualsDay(expiry: string, day: string) {
  const trimmed = expiry.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10) === day;
  const swapped = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (swapped) return `${swapped[3]}-${swapped[2]}-${swapped[1]}` === day;
  return false;
}

export function isExpiryCalendarDay(instrumentId: string, day: string) {
  return istWeekday(day) === expiryWeekday(instrumentId);
}

/** Live playbook: true only if the selected chain expires today. */
export function liveExpirySession(instrumentId: string, expiry?: string) {
  const today = todayIst();
  if (expiry && /^\d{4}-\d{2}-\d{2}/.test(expiry.trim())) {
    return expiryEqualsDay(expiry, today);
  }
  if (expiry && expiryEqualsDay(expiry, today)) return true;
  return isExpiryCalendarDay(instrumentId, today);
}

/** Undefined expirySession means expiry (legacy tests / callers). */
export function isExpirySessionCtx(ctx: Pick<EntryContext, "expirySession">) {
  return ctx.expirySession !== false;
}

/** True if `day` is an expiry session (or holiday-shifted previous day). */
export function isExpirySession(
  instrumentId: string,
  day: string,
  availableDays: string[],
) {
  const target = expiryWeekday(instrumentId);
  if (istWeekday(day) === target) return true;
  // Holiday shift: day is previous available day before a missing target weekday
  const idx = availableDays.indexOf(day);
  if (idx < 0) return false;
  const next = availableDays[idx + 1];
  if (!next) return false;
  // If next trading day skips over the target weekday, this day is the shifted expiry
  const dayWd = istWeekday(day);
  const nextWd = istWeekday(next);
  // e.g. Mon then Wed means Tuesday was holiday → Monday is expiry
  if (dayWd === (target + 6) % 7 && nextWd === (target + 1) % 7) return true;
  return false;
}

export function listExpiryDays(instrumentId: string, availableDays: string[]) {
  return availableDays.filter((d) => isExpirySession(instrumentId, d, availableDays));
}

export function toHourlyBars(bars: RollingBar[]) {
  const bySlot = new Map<string, { day: string; hour: number; bar: RollingBar }>();
  for (const bar of bars) {
    const { day, hour } = istParts(bar.timestamp);
    // Keep last bar in each hour
    bySlot.set(`${day}|${hour}`, { day, hour, bar });
  }
  return [...bySlot.values()].sort((a, b) =>
    a.day === b.day ? a.hour - b.hour : a.day.localeCompare(b.day),
  );
}

export function hoursOnDay(
  bars: RollingBar[],
  day: string,
): Array<{ hour: number; bar: RollingBar }> {
  return toHourlyBars(bars)
    .filter((x) => x.day === day)
    .map(({ hour, bar }) => ({ hour, bar }));
}

export function computeMaxPain(rows: OptionChainRow[]): number | null {
  if (rows.length === 0) return null;
  let bestStrike = rows[0].strike;
  let bestPain = Number.POSITIVE_INFINITY;
  for (const pivot of rows) {
    let pain = 0;
    for (const row of rows) {
      const ceOi = row.ce?.oi ?? 0;
      const peOi = row.pe?.oi ?? 0;
      pain += ceOi * Math.max(0, pivot.strike - row.strike);
      pain += peOi * Math.max(0, row.strike - pivot.strike);
    }
    if (pain < bestPain) {
      bestPain = pain;
      bestStrike = pivot.strike;
    }
  }
  return bestStrike;
}

/** Approx max pain from rolling OI at a snapshot of strikes. */
export function maxPainFromSnapshot(
  strikes: Record<string, number>,
  oiByKey: Record<string, { ce: number; pe: number }>,
): number | null {
  const rows: OptionChainRow[] = Object.keys(strikes).map((key) => ({
    strike: strikes[key],
    ce: {
      lastPrice: 0,
      oi: oiByKey[key]?.ce ?? 0,
      volume: 0,
      iv: 0,
      bid: 0,
      ask: 0,
      delta: 0,
      theta: 0,
      gamma: 0,
      vega: 0,
    },
    pe: {
      lastPrice: 0,
      oi: oiByKey[key]?.pe ?? 0,
      volume: 0,
      iv: 0,
      bid: 0,
      ask: 0,
      delta: 0,
      theta: 0,
      gamma: 0,
      vega: 0,
    },
  }));
  if (rows.length < 3) return null;
  return computeMaxPain(rows);
}

export function oiWalls(rows: OptionChainRow[]) {
  let putSupport: number | null = null;
  let putOi = -1;
  let callResist: number | null = null;
  let callOi = -1;
  for (const row of rows) {
    const p = row.pe?.oi ?? 0;
    const c = row.ce?.oi ?? 0;
    if (p > putOi) {
      putOi = p;
      putSupport = row.strike;
    }
    if (c > callOi) {
      callOi = c;
      callResist = row.strike;
    }
  }
  return { putSupport, callResist };
}

export function oiWallsFromSnapshot(
  strikes: Record<string, number>,
  oiByKey: Record<string, { ce: number; pe: number }>,
) {
  let putSupport: number | null = null;
  let putOi = -1;
  let callResist: number | null = null;
  let callOi = -1;
  for (const [key, strike] of Object.entries(strikes)) {
    const p = oiByKey[key]?.pe ?? 0;
    const c = oiByKey[key]?.ce ?? 0;
    if (p > putOi) {
      putOi = p;
      putSupport = strike;
    }
    if (c > callOi) {
      callOi = c;
      callResist = strike;
    }
  }
  return { putSupport, callResist };
}

export function buildDayStructure(input: {
  day: string;
  spot: number;
  open: number;
  priorHigh: number;
  priorLow: number;
  priorClose: number;
  morningBars: Array<{ hour: number; bar: RollingBar }>;
  maxPain: number | null;
  putOiSupport: number | null;
  callOiResistance: number | null;
}): DayStructure {
  // Opening-range proxy: first session hour(s) only (typically 9:xx IST).
  // Use bar.spot (index), never option OHLC — rolling bars' high/low are premiums.
  const morning = input.morningBars.filter((b) => b.hour <= 9);
  const morningSlice =
    morning.length > 0
      ? morning.slice(0, Math.max(1, ORB_HOURS))
      : input.morningBars.slice(0, 1);

  let morningHigh = input.open;
  let morningLow = input.open;
  for (const { bar } of morningSlice) {
    const px = bar.spot || input.open;
    morningHigh = Math.max(morningHigh, px);
    morningLow = Math.min(morningLow, px);
  }

  // Break confirmed on 10:xx–11:xx spot vs morning spot range + buffer.
  const buffer = Math.max(40, (input.spot || input.open) * 0.002);
  const after = input.morningBars.filter((b) => b.hour >= 10 && b.hour <= 11);
  let orbBrokenUp = false;
  let orbBrokenDown = false;
  for (const { bar } of after) {
    const px = bar.spot || input.open;
    if (px > morningHigh + buffer) orbBrokenUp = true;
    if (px < morningLow - buffer) orbBrokenDown = true;
  }
  if (orbBrokenUp && orbBrokenDown) {
    orbBrokenUp = false;
    orbBrokenDown = false;
  }

  const priorRangePct =
    input.priorClose > 0
      ? ((input.priorHigh - input.priorLow) / input.priorClose) * 100
      : 99;
  const quietDay = priorRangePct <= QUIET_PRIOR_RANGE_PCT;
  const insidePriorRange =
    input.open >= input.priorLow && input.open <= input.priorHigh;

  const distToMaxPain =
    input.maxPain !== null ? input.spot - input.maxPain : null;

  return {
    day: input.day,
    spot: input.spot,
    open: input.open,
    priorHigh: input.priorHigh,
    priorLow: input.priorLow,
    priorClose: input.priorClose,
    morningHigh,
    morningLow,
    orbBrokenUp,
    orbBrokenDown,
    quietDay,
    insidePriorRange,
    maxPain: input.maxPain,
    putOiSupport: input.putOiSupport,
    callOiResistance: input.callOiResistance,
    distToMaxPain,
  };
}

export function inMaxPainBand(dist: number | null) {
  if (dist === null) return false;
  const abs = Math.abs(dist);
  return abs >= MAX_PAIN_MIN_DIST && abs <= MAX_PAIN_MAX_DIST;
}

export function nearLevel(spot: number, level: number | null, band = 60) {
  if (level === null) return false;
  return Math.abs(spot - level) <= band;
}

/** Strike keys ATM±0..N for rolling fetch. */
export function atmBandKeys(n = 4) {
  const keys: string[] = [];
  for (let i = -n; i <= n; i += 1) keys.push(strikeKey(i));
  return keys;
}

export function chainAroundAtm(rows: OptionChainRow[], spot: number, n = 8) {
  const atm = atmIndex(rows, spot);
  const from = Math.max(0, atm - n);
  const to = Math.min(rows.length, atm + n + 1);
  return rows.slice(from, to);
}

export function orbBreakBufferPts(instrumentId: string, spot: number) {
  const floor = ORB_MIN_BREAK_PTS[instrumentId] ?? 80;
  return Math.max(floor, spot * ORB_BREAK_PCT);
}

export function maxExpiryDebitPts(instrumentId: string) {
  return MAX_EXPIRY_DEBIT_PTS[instrumentId] ?? 70;
}

export function maxDailyDebitPts(instrumentId: string) {
  return MAX_DAILY_DEBIT_PTS[instrumentId] ?? 80;
}

export function maxDebitPts(instrumentId: string, expirySession: boolean) {
  return expirySession
    ? maxExpiryDebitPts(instrumentId)
    : maxDailyDebitPts(instrumentId);
}

/** True when a directional buy would fight expiry pin toward max pain. */
export function orbFightsMaxPain(
  structure: DayStructure,
  direction: "up" | "down",
) {
  if (structure.distToMaxPain === null) return false;
  if (direction === "up" && structure.distToMaxPain > 0) return true;
  if (direction === "down" && structure.distToMaxPain < 0) return true;
  return false;
}

export function applyLiveQuoteStructure(
  structure: DayStructure,
  quote: { open: number; high: number; low: number; prevClose: number },
  spot: number,
  instrumentId: string,
) {
  const open = quote.open || structure.open;
  const prev = quote.prevClose || structure.priorClose || spot;
  const rangePct = prev > 0 ? ((quote.high - quote.low) / prev) * 100 : 99;
  structure.quietDay = rangePct <= LIVE_QUIET_RANGE_PCT;
  structure.open = open;

  const buf = orbBreakBufferPts(instrumentId, spot);
  const chop =
    quote.high >= open + buf * 0.6 && quote.low <= open - buf * 0.6;
  let orbBrokenUp = !chop && spot >= open + buf;
  let orbBrokenDown = !chop && spot <= open - buf;
  if (orbBrokenUp && orbBrokenDown) {
    orbBrokenUp = false;
    orbBrokenDown = false;
  }
  structure.orbBrokenUp = orbBrokenUp;
  structure.orbBrokenDown = orbBrokenDown;
  return structure;
}
