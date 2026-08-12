import { ironCondorStrategy, IC_DEFAULTS } from "./iron-condor";
import { orbAtmStrategy, ORB_DEFAULTS } from "./orb-atm";
import { maxPainStrategy, maxPainTargets, MAX_PAIN_DEFAULTS } from "./max-pain-reversion";
import { oiRangeFadeStrategy, OI_FADE_DEFAULTS } from "./oi-range-fade";
import type { EntryContext, OpenPosition, Strategy, TradeProposal } from "./types";
import type { OptionChainRow } from "../dhan/option-chain";
import {
  INDEX_INSTRUMENTS,
  type IndexInstrument,
} from "../dhan/instruments";
import {
  buildDayStructure,
  chainAroundAtm,
  computeMaxPain,
  oiWalls,
} from "./expiry-day";

const STRATEGIES: Strategy[] = [
  orbAtmStrategy,
  ironCondorStrategy,
  maxPainStrategy,
  oiRangeFadeStrategy,
];

export function listStrategies() {
  return STRATEGIES;
}

export function getStrategy(id: string) {
  return STRATEGIES.find((s) => s.id === id);
}

export function positionDefaults(strategyId: string): Partial<OpenPosition> {
  switch (strategyId) {
    case "ORB_ATM":
      return ORB_DEFAULTS;
    case "IRON_CONDOR":
      return IC_DEFAULTS;
    case "MAX_PAIN_REV":
      return MAX_PAIN_DEFAULTS;
    case "OI_RANGE_FADE":
      return OI_FADE_DEFAULTS;
    default:
      return {};
  }
}

/**
 * Auto picker priority: ORB → Iron Condor → Max Pain → OI fade → sit out.
 */
export function pickExpiryPath(
  ctx: EntryContext,
  strategyIds?: string[],
): { strategy: Strategy; proposal: TradeProposal; reason: string } | null {
  const allowed = strategyIds?.length
    ? STRATEGIES.filter((s) => strategyIds.includes(s.id))
    : STRATEGIES;

  const order = ["ORB_ATM", "IRON_CONDOR", "MAX_PAIN_REV", "OI_RANGE_FADE"];
  for (const id of order) {
    const strategy = allowed.find((s) => s.id === id);
    if (!strategy) continue;
    if (!strategy.isEligible(ctx)) continue;
    const proposal = strategy.proposeEntry(ctx);
    if (!proposal) continue;
    const reason =
      id === "ORB_ATM"
        ? `ORB ${ctx.structure.orbBrokenUp ? "up" : "down"} → ATM buy`
        : id === "IRON_CONDOR"
          ? "Quiet range Tuesday → Iron Condor"
          : id === "MAX_PAIN_REV"
            ? `Max pain ${ctx.structure.maxPain} (${Math.round(ctx.structure.distToMaxPain ?? 0)} pts) → reversion`
            : "Near OI wall → range fade";
    return { strategy, proposal, reason };
  }
  return null;
}

/** Live chain playbook cards. */
export function buildPlaybookCards(
  rows: OptionChainRow[],
  spot: number,
  widthSteps = 2,
  quote?: { open: number; high: number; low: number; prevClose: number },
  instrument: IndexInstrument = INDEX_INSTRUMENTS[0],
) {
  const subset = chainAroundAtm(rows, spot, 10);
  const maxPain = computeMaxPain(subset);
  const walls = oiWalls(subset);
  const open = quote?.open ?? spot;
  const structure = buildDayStructure({
    day: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }),
    spot,
    open,
    priorHigh: quote?.high ?? spot * 1.005,
    priorLow: quote?.low ?? spot * 0.995,
    priorClose: quote?.prevClose ?? spot,
    morningBars: [],
    maxPain,
    putOiSupport: walls.putSupport,
    callOiResistance: walls.callResist,
  });
  // Without intraday bars, infer mild structure for live preview
  structure.quietDay = true;
  structure.insidePriorRange =
    open >= structure.priorLow && open <= structure.priorHigh;

  const hour = Number(
    new Date().toLocaleTimeString("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      hour12: false,
    }).slice(0, 2),
  );

  return STRATEGIES.map((strategy) => {
    const ctx: EntryContext = {
      instrument,
      spot,
      widthSteps,
      hour,
      structure,
      rows: subset,
    };
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
        reason: eligible
          ? "Cannot build from current chain"
          : "Not eligible for current structure / clock",
      };
    }
    return {
      ...proposal,
      id: strategy.id,
      available: true,
    };
  });
}

/** @deprecated */
export function buildCreditSpreads(
  rows: OptionChainRow[],
  spot: number,
  widthSteps = 2,
  quote?: { open: number; high: number; low: number; prevClose: number },
  instrument?: IndexInstrument,
) {
  return buildPlaybookCards(rows, spot, widthSteps, quote, instrument);
}

export type { TradeProposal as CreditSpreadProposal, Strategy };
export { maxPainTargets };
