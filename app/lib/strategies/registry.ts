import { ironCondorStrategy, IC_DEFAULTS } from "./iron-condor";
import { orbAtmStrategy, ORB_DEFAULTS } from "./orb-atm";
import { maxPainStrategy, MAX_PAIN_DEFAULTS } from "./max-pain-reversion";
import { oiRangeFadeStrategy, OI_FADE_DEFAULTS } from "./oi-range-fade";
import {
  pmSrReversalStrategy,
  PM_SR_DEFAULTS,
} from "./pm-sr-reversal";
import {
  isProjectOne,
  projectOneDefaults,
  projectOneStrategy,
} from "./project-one";
import {
  SWEEP_FADE_DEFAULTS,
  SWEEP_FADE_ID,
  detectLiquiditySweep,
  sweepBuffer,
  sweepFadeStrategy,
  sweepIsFresh,
  sweepPositionExtras,
  type SweepBar,
} from "./liquidity-sweep";
import {
  EXPIRY_TREND_DEFAULTS,
  EXPIRY_TREND_ID,
  expiryTrendCreditStrategy,
  inExpiryTrendWindow,
} from "./expiry-trend-credit";
import { proposalCoversCosts } from "./cost-filter";
import {
  FLAT_BY_HOUR,
  STOP_LOSS_CREDIT_MULT,
  istClock,
} from "./types";
import type {
  EntryContext,
  OpenPosition,
  Strategy,
  SweepSignal,
  TradeProposal,
} from "./types";
import type { OptionChainRow } from "../dhan/option-chain-types";
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
  liveExpirySession,
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
  picks: Array<{ strategyId: string; name: string; reason: string }>;
  pick: { strategyId: string; name: string; reason: string } | null;
  sitReason: string | null;
  path: Array<{
    id: string;
    name: string;
    status: "picked" | "eligible" | "blocked";
  }>;
};

const STRATEGIES: Strategy[] = [expiryTrendCreditStrategy];

/** Retired from entries; kept so trades they already opened still settle and exit. */
const LEGACY_STRATEGIES: Strategy[] = [
  projectOneStrategy,
  orbAtmStrategy,
  sweepFadeStrategy,
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
  expiry?: string,
  tape: SweepBar[] = [],
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
  structure.insidePriorRange =
    (quote ? quote.open : spot) >= structure.priorLow &&
    (quote ? quote.open : spot) <= structure.priorHigh;

  const { hour, minute } = istClock();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const weekday = istWeekday(today);
  const weekdayLabel = new Date(`${today}T12:00:00+05:30`).toLocaleDateString("en-IN", {
    weekday: "long",
    timeZone: "Asia/Kolkata",
  });
  const isWeekend = weekday === 0 || weekday === 6;
  const isExpiryDay = liveExpirySession(instrument.id, expiry);
  const inEntryWindow = !isWeekend && inExpiryTrendWindow(hour, minute);
  const sweep = detectLiquiditySweep({
    bars: tape.filter((bar) => bar.day === today),
    priorHigh: structure.priorHigh,
    priorLow: structure.priorLow,
    putOi: structure.putOiSupport,
    callOi: structure.callOiResistance,
    buffer: sweepBuffer(instrument.id),
    pick: "latest",
  });
  const freshSweep = sweep && sweepIsFresh(sweep, hour, minute) ? sweep : null;

  const ctx: EntryContext = {
    instrument,
    spot,
    widthSteps,
    hour,
    minute,
    structure,
    rows: subset,
    expirySession: isExpiryDay,
    sweep: freshSweep,
  };

  const playbookStrategies: Array<{
    strategy: Strategy;
    blocked: string;
    requireCosts: boolean;
  }> = [
    {
      strategy: expiryTrendCreditStrategy,
      blocked: "Nifty expiry day only, 12:30–12:45 IST",
      requireCosts: true,
    },
  ];

  const spreads: PlaybookCard[] = playbookStrategies.map(
    ({ strategy, blocked, requireCosts }) => {
      const eligible = strategy.isEligible(ctx);
      const proposal = eligible ? strategy.proposeEntry(ctx) : null;
      const affordable = proposal
        ? !requireCosts || proposalCoversCosts(proposal, instrument.id).ok
        : false;
      if (!proposal || !affordable) {
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
          reason:
            proposal && !affordable
              ? "Credit does not cover costs"
              : eligible
                ? "No cheap credit — sitting out"
                : blocked,
        };
      }
      return { ...proposal, id: strategy.id, available: true };
    },
  );

  const live = !isWeekend && inEntryWindow;
  const picks = live ? pickPlaybookEntries(ctx) : [];
  const sitReason =
    picks.length > 0
      ? null
      : isWeekend
        ? `${weekdayLabel} — market closed. Sitting out.`
        : instrument.id !== "NIFTY"
          ? "Expiry Trend Credit trades Nifty only — sitting out."
          : !isExpiryDay
            ? "Not a Nifty expiry day — sitting out."
            : !inEntryWindow
              ? "Waiting for 12:30–12:45 IST on expiry day."
              : "No trend vs open or credit too small — sitting out.";

  const path = playbookStrategies.map(({ strategy }) => {
    const card = spreads.find((s) => s.id === strategy.id);
    const status = picks.some((pick) => pick.strategy.id === strategy.id)
      ? ("picked" as const)
      : card?.available
        ? ("eligible" as const)
        : ("blocked" as const);
    return { id: strategy.id, name: strategy.name, status };
  });

  const pickCards = picks.map((pick) => ({
    strategyId: pick.strategy.id,
    name: pick.strategy.name,
    reason: pick.reason,
  }));
  return {
    spreads,
    structure,
    hour,
    isExpiryDay,
    inEntryWindow,
    picks: pickCards,
    pick: pickCards[0] ?? null,
    sitReason,
    path,
  };
}

export function autoPlaybookStrategyIds() {
  return [EXPIRY_TREND_ID];
}

/** Strategies shown in the backtest dropdown. */
export function listBacktestStrategies() {
  return [{ id: EXPIRY_TREND_ID, name: expiryTrendCreditStrategy.name }];
}

export function pickPlaybookEntries(
  ctx: EntryContext,
): Array<{ strategy: Strategy; proposal: TradeProposal; reason: string }> {
  const picks: Array<{ strategy: Strategy; proposal: TradeProposal; reason: string }> = [];
  if (expiryTrendCreditStrategy.isEligible(ctx)) {
    const proposal = expiryTrendCreditStrategy.proposeEntry(ctx);
    if (proposal && proposalCoversCosts(proposal, ctx.instrument.id).ok) {
      picks.push({
        strategy: expiryTrendCreditStrategy,
        proposal,
        reason: proposal.description,
      });
    }
  }
  return picks;
}

export function pickPlaybookPath(
  ctx: EntryContext,
  _strategyIds?: string[],
): { strategy: Strategy; proposal: TradeProposal; reason: string } | null {
  return pickPlaybookEntries(ctx)[0] ?? null;
}

export function positionDefaults(
  strategyId: string,
  expirySession?: boolean,
  opts?: { credit?: number; hour?: number; sweep?: SweepSignal | null },
): Partial<OpenPosition> {
  if (isProjectOne(strategyId)) {
    return projectOneDefaults({ ...opts, expirySession });
  }
  switch (strategyId) {
    case "IRON_CONDOR":
      return { ...IC_DEFAULTS, flatByHour: FLAT_BY_HOUR };
    case "ORB_ATM":
      return ORB_DEFAULTS;
    case "MAX_PAIN_REV":
      return MAX_PAIN_DEFAULTS;
    case "OI_RANGE_FADE":
      return { ...OI_FADE_DEFAULTS, flatByHour: FLAT_BY_HOUR };
    case SWEEP_FADE_ID:
      return { ...SWEEP_FADE_DEFAULTS, ...sweepPositionExtras(opts?.sweep) };
    case "PM_SR_REVERSAL":
      return PM_SR_DEFAULTS;
    case EXPIRY_TREND_ID:
      return EXPIRY_TREND_DEFAULTS;
    default:
      return { stopMult: STOP_LOSS_CREDIT_MULT, flatByHour: FLAT_BY_HOUR };
  }
}

export function getStrategy(id: string) {
  if (id === SWEEP_FADE_ID) return sweepFadeStrategy;
  if (isProjectOne(id)) return projectOneStrategy;
  return (
    STRATEGIES.find((s) => s.id === id) ??
    LEGACY_STRATEGIES.find((s) => s.id === id)
  );
}

export function listStrategies() {
  return STRATEGIES.slice();
}

export type { Strategy };
