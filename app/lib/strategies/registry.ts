import { ironCondorStrategy, IC_DEFAULTS } from "./iron-condor";
import { orbAtmStrategy, ORB_DEFAULTS } from "./orb-atm";
import { maxPainStrategy, maxPainTargets, MAX_PAIN_DEFAULTS } from "./max-pain-reversion";
import { oiRangeFadeStrategy, OI_FADE_DEFAULTS } from "./oi-range-fade";
import { DAILY_FLAT_BY_HOUR } from "./types";
import type { EntryContext, OpenPosition, Strategy, TradeProposal } from "./types";
import type { OptionChainRow } from "../dhan/option-chain";
import {
  INDEX_INSTRUMENTS,
  type IndexInstrument,
} from "../dhan/instruments";
import {
  buildLiveDayStructure,
  chainAroundAtm,
  computeMaxPain,
  isExpirySessionCtx,
  liveExpirySession,
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

export function positionDefaults(
  strategyId: string,
  expirySession = false,
): Partial<OpenPosition> {
  switch (strategyId) {
    case "ORB_ATM":
      return ORB_DEFAULTS;
    case "IRON_CONDOR":
      return expirySession
        ? IC_DEFAULTS
        : { ...IC_DEFAULTS, flatByHour: DAILY_FLAT_BY_HOUR };
    case "MAX_PAIN_REV":
      return MAX_PAIN_DEFAULTS;
    case "OI_RANGE_FADE":
      return expirySession
        ? OI_FADE_DEFAULTS
        : { ...OI_FADE_DEFAULTS, flatByHour: DAILY_FLAT_BY_HOUR };
    default:
      return {};
  }
}

const EXPIRY_ORDER = ["IRON_CONDOR", "OI_RANGE_FADE", "MAX_PAIN_REV", "ORB_ATM"];
const DAILY_ORDER = ["ORB_ATM", "OI_RANGE_FADE", "IRON_CONDOR", "MAX_PAIN_REV"];

function pickReason(id: string, ctx: EntryContext) {
  if (id === "ORB_ATM") {
    const dir = ctx.structure.orbBrokenUp ? "up" : "down";
    return isExpirySessionCtx(ctx)
      ? `ORB ${dir} → ATM buy`
      : `ORB ${dir} → debit spread`;
  }
  if (id === "IRON_CONDOR") {
    return isExpirySessionCtx(ctx)
      ? "Quiet range expiry → Iron Condor"
      : "Quiet range day → Iron Condor";
  }
  if (id === "MAX_PAIN_REV") {
    return `Max pain ${ctx.structure.maxPain} (${Math.round(ctx.structure.distToMaxPain ?? 0)} pts) → reversion`;
  }
  return "Near OI wall → range fade";
}

/**
 * Auto picker: expiry sells premium first; other weekdays prefer ORB then fades.
 */
export function pickPlaybookPath(
  ctx: EntryContext,
  strategyIds?: string[],
): { strategy: Strategy; proposal: TradeProposal; reason: string } | null {
  const allowed = strategyIds?.length
    ? STRATEGIES.filter((s) => strategyIds.includes(s.id))
    : STRATEGIES;

  const order = isExpirySessionCtx(ctx) ? EXPIRY_ORDER : DAILY_ORDER;
  for (const id of order) {
    const strategy = allowed.find((s) => s.id === id);
    if (!strategy) continue;
    if (!strategy.isEligible(ctx)) continue;
    const proposal = strategy.proposeEntry(ctx);
    if (!proposal) continue;
    return { strategy, proposal, reason: pickReason(id, ctx) };
  }
  return null;
}

/** @deprecated use pickPlaybookPath */
export function pickExpiryPath(
  ctx: EntryContext,
  strategyIds?: string[],
) {
  return pickPlaybookPath(ctx, strategyIds);
}

/** Live chain playbook cards. */
export function buildPlaybookCards(
  rows: OptionChainRow[],
  spot: number,
  widthSteps = 2,
  quote?: { open: number; high: number; low: number; prevClose: number },
  instrument: IndexInstrument = INDEX_INSTRUMENTS[0],
  expiry?: string,
  prior?: { high: number; low: number; close: number } | null,
) {
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
    prior,
  });

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
      expirySession: liveExpirySession(instrument.id, expiry),
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
