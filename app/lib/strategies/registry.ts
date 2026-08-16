import { ironCondorStrategy, IC_DEFAULTS } from "./iron-condor";
import { orbAtmStrategy, ORB_DEFAULTS } from "./orb-atm";
import { maxPainStrategy, maxPainTargets, MAX_PAIN_DEFAULTS } from "./max-pain-reversion";
import { oiRangeFadeStrategy, OI_FADE_DEFAULTS } from "./oi-range-fade";
import { FLAT_BY_HOUR, DAILY_FLAT_BY_HOUR } from "./types";
import type { EntryContext, Strategy, TradeProposal } from "./types";
import type { OptionChainRow } from "../dhan/option-chain";
import {
  INDEX_INSTRUMENTS,
  type IndexInstrument,
} from "../dhan/instruments";
import {
  buildLiveDayStructure,
  chainAroundAtm,
  computeMaxPain,
  oiWalls,
  istWeekday,
  expiryWeekday,
} from "../dhan/expiry-day";

export type PlaybookCard = TradeProposal & {
  id: string;
  available: boolean;
  reason?: string;
};

export type PlaybookSnapshot = {
  spreads: PlaybookCard[];
  structure: ReturnType<typeof buildLiveDayStructure>;
  hour: number;
  isExpiryDay: boolean;
  inEntryWindow: boolean;
  pick: { strategyId: string; name: string; reason: string } | null;
  sitReason: string | null;
  path: Array<{
    id: string;
    name: string;
    status: "picked" | "eligible" | "blocked";
  }>;
};

const STRATEGIES: Strategy[] = [orbAtmStrategy, oiRangeFadeStrategy, ironCondorStrategy, maxPainStrategy];

export function buildPlaybookSnapshot(
  rows: OptionChainRow[],
  spot: number,
  widthSteps = 2,
  quote?: { open: number; high: number; low: number; prevClose: number },
  instrument: IndexInstrument = INDEX_INSTRUMENTS[0],
): PlaybookSnapshot {
  const subset = chainAroundAtm(rows, spot, 10);
  const maxPain = computeMaxPain(subset);
  const walls = oiWalls(subset);
  const structure = buildLiveDayStructure({
    day: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }),
    spot,
    instrumentId: instrument.id,
    maxPain,
    putOiSupport: walls.putSupport,
    callOiResistance: walls.callResist,
    quote,
    prior: undefined,
  });

  if (quote) {
    const rangePct = quote.prevClose > 0 ? ((quote.high - quote.low) / quote.prevClose) * 100 : 99;
    structure.quietDay = rangePct <= 1.2;
    structure.orbBrokenUp = spot > quote.open * 1.003;
    structure.orbBrokenDown = spot < quote.open * 0.997;
    if (structure.orbBrokenUp && structure.orbBrokenDown) {
      structure.orbBrokenUp = false;
      structure.orbBrokenDown = false;
    }
  } else {
    structure.quietDay = true;
  }
  structure.insidePriorRange = (quote ? quote.open : spot) >= structure.priorLow && (quote ? quote.open : spot) <= structure.priorHigh;

  const hour = Number(new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).slice(0, 2));
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const weekday = istWeekday(today);
  const weekdayLabel = new Date(`${today}T12:00:00+05:30`).toLocaleDateString("en-IN", { weekday: "long", timeZone: "Asia/Kolkata" });
  const isWeekend = weekday === 0 || weekday === 6;
  const isExpiryDay = weekday === expiryWeekday(instrument.id);
  const inEntryWindow = !isWeekend && hour >= 10 && hour < FLAT_BY_HOUR;

  const ctx: EntryContext = { instrument, spot, widthSteps, hour, structure, rows: subset };

  const spreads: PlaybookCard[] = STRATEGIES.map((strategy) => {
    const eligible = strategy.isEligible(ctx);
    const proposal = eligible ? strategy.proposeEntry(ctx) : null;
    if (!proposal) {
      return {
        id: strategy.id,
        strategyId: strategy.id,
        name: strategy.name,
        bias: strategy.bias,
        description: strategy.description,
        legs: [],
        netCredit: 0,
        maxProfit: 0,
        maxLoss: 0,
        width: 0,
        primaryShortStrike: 0,
        primaryLongStrike: 0,
        primaryShortSide: "CE" as const,
        primaryLongSide: "CE" as const,
        available: false,
        reason: eligible ? "Cannot build from current chain" : "Not eligible for current structure / clock",
      };
    }
    return { ...proposal, id: strategy.id, available: true };
  });

  const live = isExpiryDay && inEntryWindow;
  const picked = live ? pickPlaybookPath(ctx) : null;
  const sitReason = picked
    ? null
    : isWeekend
      ? `${weekdayLabel} — market closed. Sitting out.`
      : !isExpiryDay
        ? `${weekdayLabel} is not expiry for ${instrument.name}. Sitting out.`
        : !inEntryWindow
          ? "Outside 10:00–14:00 IST. Sitting out."
          : "No setup matches current structure.";

  const path = STRATEGIES.map((strategy) => {
    const card = spreads.find((s) => s.id === strategy.id);
    const status = picked?.strategy.id === strategy.id ? ("picked" as const) : card?.available ? ("eligible" as const) : ("blocked" as const);
    return { id: strategy.id, name: strategy.name, status };
  });

  return { spreads, structure, hour, isExpiryDay, inEntryWindow, pick: picked ? { strategyId: picked.strategy.id, name: picked.strategy.name, reason: picked.reason } : null, sitReason, path };
}

export function buildPlaybookCards(rows: OptionChainRow[], spot: number, widthSteps = 2, quote?: { open: number; high: number; low: number; prevClose: number }, instrument: IndexInstrument = INDEX_INSTRUMENTS[0]) {
  return buildPlaybookSnapshot(rows, spot, widthSteps, quote, instrument).spreads;
}

/** @deprecated use pickPlaybookPath */
export function pickExpiryPath(ctx: EntryContext, strategyIds?: string[]) {
  return pickPlaybookPath(ctx, strategyIds);
}

const EXPIRY_ORDER = ["IRON_CONDOR", "OI_RANGE_FADE", "MAX_PAIN_REV", "ORB_ATM"];
const DAILY_ORDER = ["ORB_ATM", "OI_RANGE_FADE", "IRON_CONDOR", "MAX_PAIN_REV"];

export function pickPlaybookPath(ctx: EntryContext, strategyIds?: string[]): { strategy: Strategy; proposal: TradeProposal; reason: string } | null {
  const allowed = strategyIds?.length ? STRATEGIES.filter((s) => strategyIds.includes(s.id)) : STRATEGIES;
  const order = ctx.structure && ctx.structure.isExpirySession ? EXPIRY_ORDER : DAILY_ORDER;
  for (const id of order) {
    const strategy = allowed.find((s) => s.id === id);
    if (!strategy) continue;
    if (!strategy.isEligible(ctx)) continue;
    const proposal = strategy.proposeEntry(ctx);
    if (!proposal) continue;
    const reason = id === "ORB_ATM" ? `ORB ${ctx.structure.orbBrokenUp ? "up" : "down"} → ATM buy` : id === "IRON_CONDOR" ? "Quiet range → Iron Condor" : id === "MAX_PAIN_REV" ? `Max pain ${ctx.structure.maxPain} (${Math.round(ctx.structure.distToMaxPain ?? 0)} pts) → reversion` : "Near OI wall → range fade";
    return { strategy, proposal, reason };
  }
  return null;
}

export type { TradeProposal as CreditSpreadProposal, Strategy };
export { maxPainTargets };
export type PlaybookCard = TradeProposal & {
  id: string;
  available: boolean;
  reason?: string;
};

export type PlaybookSnapshot = {
  spreads: PlaybookCard[];
  structure: ReturnType<typeof buildLiveDayStructure>;
  hour: number;
  isExpiryDay: boolean;
  inEntryWindow: boolean;
  pick: { strategyId: string; name: string; reason: string } | null;
  sitReason: string | null;
  path: Array<{
    id: string;
    name: string;
    status: "picked" | "eligible" | "blocked";
  }>;
};

/** Live chain playbook snapshot (cards + structure for UI). */
export function buildPlaybookSnapshot(
  rows: OptionChainRow[],
  spot: number,
  widthSteps = 2,
  quote?: { open: number; high: number; low: number; prevClose: number },
  instrument: IndexInstrument = INDEX_INSTRUMENTS[0],
): PlaybookSnapshot {
  const subset = chainAroundAtm(rows, spot, 10);
  const maxPain = computeMaxPain(subset);
  const walls = oiWalls(subset);
  const structure = buildLiveDayStructure({
    day: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }),
    spot,
    instrumentId: instrument.id,
    maxPain,
    putOiSupport: walls.putSupport,
    callOiResistance: walls.callResist,
    quote,
    prior: undefined,
  });

  if (quote) {
    const rangePct = quote.prevClose > 0 ? ((quote.high - quote.low) / quote.prevClose) * 100 : 99;
    structure.quietDay = rangePct <= 1.2;
    structure.orbBrokenUp = spot > quote.open * 1.003;
    structure.orbBrokenDown = spot < quote.open * 0.997;
    if (structure.orbBrokenUp && structure.orbBrokenDown) {
      structure.orbBrokenUp = false;
      structure.orbBrokenDown = false;
    }
  } else {
    structure.quietDay = true;
  }
  structure.insidePriorRange = (quote ? quote.open : spot) >= structure.priorLow && (quote ? quote.open : spot) <= structure.priorHigh;

  const hour = Number(new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).slice(0, 2));
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const weekday = istWeekday(today);
  const weekdayLabel = new Date(`${today}T12:00:00+05:30`).toLocaleDateString("en-IN", { weekday: "long", timeZone: "Asia/Kolkata" });
  const isWeekend = weekday === 0 || weekday === 6;
  const isExpiryDay = weekday === expiryWeekday(instrument.id);
  const inEntryWindow = !isWeekend && hour >= 10 && hour < FLAT_BY_HOUR;

  const ctx: EntryContext = { instrument, spot, widthSteps, hour, structure, rows: subset };

  const spreads: PlaybookCard[] = STRATEGIES.map((strategy) => {
    const eligible = strategy.isEligible(ctx);
    const proposal = eligible ? strategy.proposeEntry(ctx) : null;
    if (!proposal) {
      return {
        id: strategy.id,
        strategyId: strategy.id,
        name: strategy.name,
        bias: strategy.bias,
        description: strategy.description,
        legs: [],
        netCredit: 0,
        maxProfit: 0,
        maxLoss: 0,
        width: 0,
        primaryShortStrike: 0,
        primaryLongStrike: 0,
        primaryShortSide: "CE" as const,
        primaryLongSide: "CE" as const,
        available: false,
        reason: eligible ? "Cannot build from current chain" : "Not eligible for current structure / clock",
      };
    }
    return { ...proposal, id: strategy.id, available: true };
  });

  const live = isExpiryDay && inEntryWindow;
  const picked = live ? pickPlaybookPath(ctx) : null;
  const sitReason = picked ? null : isWeekend ? `${weekdayLabel} — market closed. Sitting out.` : !isExpiryDay ? `${weekdayLabel} is not expiry for ${instrument.name}. Sitting out.` : !inEntryWindow ? "Outside 10:00–14:00 IST. Sitting out." : "No setup matches current structure.";

  const path = STRATEGIES.map((strategy) => {
    const card = spreads.find((s) => s.id === strategy.id);
    const status = picked?.strategy.id === strategy.id ? ("picked" as const) : card?.available ? ("eligible" as const) : ("blocked" as const);
    return { id: strategy.id, name: strategy.name, status };
  });

  return { spreads, structure, hour, isExpiryDay, inEntryWindow, pick: picked ? { strategyId: picked.strategy.id, name: picked.strategy.name, reason: picked.reason } : null, sitReason, path };
}

/** Live chain playbook cards. */
export function buildPlaybookCards(rows: OptionChainRow[], spot: number, widthSteps = 2, quote?: { open: number; high: number; low: number; prevClose: number }, instrument: IndexInstrument = INDEX_INSTRUMENTS[0]) {
  return buildPlaybookSnapshot(rows, spot, widthSteps, quote, instrument).spreads;
}
  rows: OptionChainRow[],
  spot: number,
  widthSteps = 2,
  quote?: { open: number; high: number; low: number; prevClose: number },
  instrument: IndexInstrument = INDEX_INSTRUMENTS[0],
) {
  return buildPlaybookSnapshot(rows, spot, widthSteps, quote, instrument)
    .spreads;
}

/** @deprecated */
export function buildCreditSpreads(
  rows: OptionChainRow[],
  spot: number,
  widthSteps = 2,
  quote?: { open: number; high: number; low: number; prevClose: number },
  instrument?: IndexInstrument,
  expiry?: string,
  prior?: { high: number; low: number; close: number } | null,
) {
  return buildPlaybookCards(
    rows,
    spot,
    widthSteps,
    quote,
    instrument,
    expiry,
    prior,
  );
}

export type { TradeProposal as CreditSpreadProposal, Strategy };
export { maxPainTargets };
