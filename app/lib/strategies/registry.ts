import { ironCondorStrategy, IC_DEFAULTS } from "./iron-condor";
import { orbAtmStrategy, ORB_DEFAULTS } from "./orb-atm";
import { maxPainStrategy, maxPainTargets, MAX_PAIN_DEFAULTS } from "./max-pain-reversion";
import { oiRangeFadeStrategy, OI_FADE_DEFAULTS } from "./oi-range-fade";
import {
  pmSrReversalStrategy,
  PM_SR_DEFAULTS,
  PM_SR_REVERSAL_ID,
} from "./pm-sr-reversal";
import {
  FLAT_BY_HOUR,
  STOP_LOSS_CREDIT_MULT,
  inMorningEntryWindow,
  inPmReversalEntryWindow,
  istClock,
  MORNING_PLAYBOOK_WINDOW,
} from "./types";
import type { EntryContext, Strategy, TradeProposal, OpenPosition } from "./types";
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
} from "./expiry-day";

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

const STRATEGIES: Strategy[] = [
  orbAtmStrategy,
  oiRangeFadeStrategy,
  ironCondorStrategy,
  maxPainStrategy,
  pmSrReversalStrategy,
];

export function buildPlaybookSnapshot(
  rows: OptionChainRow[],
  spot: number,
  widthSteps = 2,
  quote?: { open: number; high: number; low: number; prevClose: number },
  instrument: IndexInstrument = INDEX_INSTRUMENTS[0],
  prior?: { high: number; low: number; close: number } | null,
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
    prior: prior ?? undefined,
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

  const { hour, minute } = istClock();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const weekday = istWeekday(today);
  const weekdayLabel = new Date(`${today}T12:00:00+05:30`).toLocaleDateString("en-IN", { weekday: "long", timeZone: "Asia/Kolkata" });
  const isWeekend = weekday === 0 || weekday === 6;
  const isExpiryDay = weekday === expiryWeekday(instrument.id);
  const inEntryWindow =
    !isWeekend &&
    (inMorningEntryWindow(hour) || inPmReversalEntryWindow(hour, minute));

  const ctx: EntryContext = {
    instrument,
    spot,
    widthSteps,
    hour,
    minute,
    structure,
    rows: subset,
  };

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

  const live = !isWeekend && inEntryWindow;
  const picked = live ? pickPlaybookPath(ctx) : null;
  const sitReason = picked
    ? null
    : isWeekend
      ? `${weekdayLabel} — market closed. Sitting out.`
      : !inEntryWindow
        ? `Outside ${MORNING_PLAYBOOK_WINDOW} and 14:00–14:15 IST. Sitting out.`
        : "No setup matches current structure.";

  const path = STRATEGIES.map((strategy) => {
    const card = spreads.find((s) => s.id === strategy.id);
    const status = picked?.strategy.id === strategy.id ? ("picked" as const) : card?.available ? ("eligible" as const) : ("blocked" as const);
    return { id: strategy.id, name: strategy.name, status };
  });

  return { spreads, structure, hour, isExpiryDay, inEntryWindow, pick: picked ? { strategyId: picked.strategy.id, name: picked.strategy.name, reason: picked.reason } : null, sitReason, path };
}

export function buildPlaybookCards(
  rows: OptionChainRow[],
  spot: number,
  widthSteps = 2,
  quote?: { open: number; high: number; low: number; prevClose: number },
  instrument: IndexInstrument = INDEX_INSTRUMENTS[0],
  prior?: { high: number; low: number; close: number } | null,
) {
  return buildPlaybookSnapshot(rows, spot, widthSteps, quote, instrument, prior).spreads;
}

/** @deprecated use pickPlaybookPath */
export function pickExpiryPath(ctx: EntryContext, strategyIds?: string[]) {
  return pickPlaybookPath(ctx, strategyIds);
}

const EXPIRY_ORDER = [
  PM_SR_REVERSAL_ID,
  "IRON_CONDOR",
  "OI_RANGE_FADE",
  "MAX_PAIN_REV",
  "ORB_ATM",
];
const DAILY_ORDER = [
  PM_SR_REVERSAL_ID,
  "ORB_ATM",
  "IRON_CONDOR",
  "OI_RANGE_FADE",
  "MAX_PAIN_REV",
];

export function pickPlaybookPath(ctx: EntryContext, strategyIds?: string[]): { strategy: Strategy; proposal: TradeProposal; reason: string } | null {
  const allowed = strategyIds?.length ? STRATEGIES.filter((s) => strategyIds.includes(s.id)) : STRATEGIES;
  const order = ctx.expirySession !== false ? EXPIRY_ORDER : DAILY_ORDER;
  for (const id of order) {
    const strategy = allowed.find((s) => s.id === id);
    if (!strategy) continue;
    if (!strategy.isEligible(ctx)) continue;
    const proposal = strategy.proposeEntry(ctx);
    if (!proposal) continue;
    const reason =
      id === PM_SR_REVERSAL_ID
        ? proposal.description
        : id === "ORB_ATM"
          ? `ORB ${ctx.structure.orbBrokenUp ? "up" : "down"} → ATM buy`
          : id === "IRON_CONDOR"
            ? "Quiet range → Iron Condor"
            : id === "MAX_PAIN_REV"
              ? `Max pain ${ctx.structure.maxPain} (${Math.round(ctx.structure.distToMaxPain ?? 0)} pts) → reversion`
              : "Near OI wall → range fade";
    return { strategy, proposal, reason };
  }
  return null;
}

export function positionDefaults(strategyId: string, _expirySession?: boolean): Partial<OpenPosition> {
  switch (strategyId) {
    case "IRON_CONDOR":
      return { ...IC_DEFAULTS, flatByHour: FLAT_BY_HOUR };
    case "ORB_ATM":
      return ORB_DEFAULTS;
    case "MAX_PAIN_REV":
      return MAX_PAIN_DEFAULTS;
    case "OI_RANGE_FADE":
      return { ...OI_FADE_DEFAULTS, flatByHour: FLAT_BY_HOUR };
    case "PM_SR_REVERSAL":
      return PM_SR_DEFAULTS;
    default:
      return { stopMult: STOP_LOSS_CREDIT_MULT, flatByHour: FLAT_BY_HOUR };
  }
}

export function getStrategy(id: string) {
  return STRATEGIES.find((s) => s.id === id);
}

export function listStrategies() {
  return STRATEGIES.slice();
}

export type { TradeProposal as CreditSpreadProposal, Strategy };
export { maxPainTargets };
