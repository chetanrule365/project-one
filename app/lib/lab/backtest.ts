import type { IndexInstrument } from "../dhan/instruments";
import {
  fetchRollingBundle,
  type RollingBar,
  type RollingProgress,
} from "../dhan/rolling-options";
import {
  autoPlaybookStrategyIds,
  getStrategy,
  pickPlaybookPath,
  positionDefaults,
} from "../strategies/registry";
import { isProjectOne } from "../strategies/project-one";
import { isPmSrReversal } from "../strategies/pm-sr-reversal";
import {
  atmBandKeys,
  buildDayStructure,
  isExpirySession,
  istParts,
  maxPainFromSnapshot,
  oiWallsFromSnapshot,
} from "../strategies/expiry-day";
import { strikeKey } from "../strategies/common";
import {
  proposalCoversCosts,
  roundTripBrokerageInr,
} from "../strategies/cost-filter";
import {
  DEFAULT_WIDTH_STEPS,
  lotSizeFor,
  type OpenPosition,
  type Strategy,
  type TradeProposal,
} from "../strategies/types";

export { DHAN_FNO_BROKERAGE_PER_ORDER } from "../strategies/cost-filter";

export type BacktestTrade = {
  strategyId: string;
  strategyName: string;
  entryDay: string;
  expiryDay: string;
  entryHour: number;
  exitHour: number;
  shortStrike: number;
  longStrike: number;
  shortSide: string;
  longSide: string;
  credit: number;
  width: number;
  spotEntry: number;
  spotExpiry: number;
  pnlPoints: number;
  pnlInr: number;
  won: boolean;
  pickReason?: string;
  exitReason?: string;
  expirySession: boolean;
  legCount?: number;
  brokerageInr?: number;
  pnlAfterBrokerageInr?: number;
};

export type BacktestMetrics = {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnlPoints: number;
  totalPnlInr: number;
  avgPnlPoints: number;
  maxDrawdownInr: number;
  profitFactor: number;
  brokerageInr: number;
  totalPnlAfterBrokerageInr: number;
  byStrategy: StrategyNetRow[];
};

export type StrategyNetRow = {
  strategyId: string;
  strategyName: string;
  trades: number;
  wins: number;
  winRate: number;
  avgPnlPoints: number;
  totalPnlInr: number;
  brokerageInr: number;
  totalPnlAfterBrokerageInr: number;
};

export function inferLegCount(
  trade: Pick<BacktestTrade, "legCount" | "shortStrike" | "longStrike" | "strategyId">,
) {
  if (trade.legCount && trade.legCount > 0) return trade.legCount;
  if (trade.strategyId === "IRON_CONDOR") return 4;
  const short = trade.shortStrike > 0;
  const long = trade.longStrike > 0;
  if (short && long && trade.shortStrike !== trade.longStrike) return 2;
  return short || long ? 1 : 2;
}

export function tradeBrokerageInr(trade: BacktestTrade) {
  if (trade.brokerageInr != null && Number.isFinite(trade.brokerageInr)) {
    return trade.brokerageInr;
  }
  return roundTripBrokerageInr(inferLegCount(trade));
}

export function tradePnlAfterBrokerageInr(trade: BacktestTrade) {
  if (
    trade.pnlAfterBrokerageInr != null &&
    Number.isFinite(trade.pnlAfterBrokerageInr)
  ) {
    return trade.pnlAfterBrokerageInr;
  }
  return trade.pnlInr - tradeBrokerageInr(trade);
}

export type BacktestResult = {
  instrumentId: string;
  strategyIds: string[];
  widthSteps: number;
  from: string;
  to: string;
  lotSize: number;
  mode: "single" | "auto";
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
};

export function computeMetrics(trades: BacktestTrade[]): BacktestMetrics {
  const wins = trades.filter((t) => tradePnlAfterBrokerageInr(t) > 0).length;
  const losses = trades.length - wins;
  const totalPnlPoints = trades.reduce((s, t) => s + t.pnlPoints, 0);
  const totalPnlInr = trades.reduce((s, t) => s + t.pnlInr, 0);
  const brokerageInr = trades.reduce((s, t) => s + tradeBrokerageInr(t), 0);
  const nets = trades.map((t) => tradePnlAfterBrokerageInr(t));
  const grossProfit = nets.filter((n) => n > 0).reduce((s, n) => s + n, 0);
  const grossLoss = Math.abs(nets.filter((n) => n < 0).reduce((s, n) => s + n, 0));

  let equity = 0;
  let peak = 0;
  let maxDrawdownInr = 0;
  for (const net of nets) {
    equity += net;
    peak = Math.max(peak, equity);
    maxDrawdownInr = Math.max(maxDrawdownInr, peak - equity);
  }

  return {
    trades: trades.length,
    wins,
    losses,
    winRate: trades.length ? (wins / trades.length) * 100 : 0,
    totalPnlPoints,
    totalPnlInr,
    avgPnlPoints: trades.length ? totalPnlPoints / trades.length : 0,
    maxDrawdownInr,
    profitFactor:
      grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    brokerageInr,
    totalPnlAfterBrokerageInr: totalPnlInr - brokerageInr,
    byStrategy: strategyNetRows(trades),
  };
}

export function strategyNetRows(trades: BacktestTrade[]): StrategyNetRow[] {
  const byId = new Map<string, BacktestTrade[]>();
  for (const trade of trades) {
    const rows = byId.get(trade.strategyId) ?? [];
    rows.push(trade);
    byId.set(trade.strategyId, rows);
  }
  return [...byId.entries()].map(([strategyId, rows]) => {
    const metrics = computeMetricsWithoutBreakdown(rows);
    return {
      strategyId,
      strategyName: rows[0]?.strategyName ?? strategyId,
      trades: metrics.trades,
      wins: metrics.wins,
      winRate: metrics.winRate,
      avgPnlPoints: metrics.avgPnlPoints,
      totalPnlInr: metrics.totalPnlInr,
      brokerageInr: metrics.brokerageInr,
      totalPnlAfterBrokerageInr: metrics.totalPnlAfterBrokerageInr,
    };
  });
}

function computeMetricsWithoutBreakdown(trades: BacktestTrade[]) {
  const wins = trades.filter((t) => tradePnlAfterBrokerageInr(t) > 0).length;
  const totalPnlPoints = trades.reduce((s, t) => s + t.pnlPoints, 0);
  const totalPnlInr = trades.reduce((s, t) => s + t.pnlInr, 0);
  const brokerageInr = trades.reduce((s, t) => s + tradeBrokerageInr(t), 0);
  return {
    trades: trades.length,
    wins,
    winRate: trades.length ? (wins / trades.length) * 100 : 0,
    avgPnlPoints: trades.length ? totalPnlPoints / trades.length : 0,
    totalPnlInr,
    brokerageInr,
    totalPnlAfterBrokerageInr: totalPnlInr - brokerageInr,
  };
}

type HourBar = { hour: number; bar: RollingBar };
type IndexedSeries = Record<string, Map<string, HourBar[]>>;

function indexSeries(series: Record<string, RollingBar[]>): IndexedSeries {
  const indexed: IndexedSeries = {};
  for (const [key, bars] of Object.entries(series)) {
    const byDay = new Map<string, Map<number, RollingBar>>();
    for (const bar of bars) {
      const { day, hour } = istParts(bar.timestamp);
      let hours = byDay.get(day);
      if (!hours) {
        hours = new Map();
        byDay.set(day, hours);
      }
      hours.set(hour, bar);
    }
    const dayMap = new Map<string, HourBar[]>();
    for (const [day, hours] of byDay) {
      dayMap.set(
        day,
        [...hours.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([hour, bar]) => ({ hour, bar })),
      );
    }
    indexed[key] = dayMap;
  }
  return indexed;
}

function hoursOnIndexed(indexed: IndexedSeries, key: string, day: string) {
  return indexed[key]?.get(day) ?? [];
}

function uniqueDays(indexed: IndexedSeries) {
  const set = new Set<string>();
  for (const byDay of Object.values(indexed)) {
    for (const day of byDay.keys()) set.add(day);
  }
  return [...set].sort();
}

function snapshotAtHour(
  indexed: IndexedSeries,
  day: string,
  hour: number,
  strikeKeys: string[],
) {
  const premiums: Record<string, number> = {};
  const strikes: Record<string, number> = {};
  const oiByKey: Record<string, { ce: number; pe: number }> = {};
  let spot = 0;

  for (const sk of strikeKeys) {
    for (const right of ["CE", "PE"] as const) {
      const key = `${sk}:${right}`;
      const hours = hoursOnIndexed(indexed, key, day);
      const bar =
        hours.find((h) => h.hour === hour)?.bar ??
        [...hours].reverse().find((h) => h.hour <= hour)?.bar;
      if (!bar) continue;
      premiums[key] = bar.close;
      strikes[sk] = bar.strike;
      if (bar.spot) spot = bar.spot;
      const bucket = oiByKey[sk] ?? { ce: 0, pe: 0 };
      if (right === "CE") bucket.ce = bar.oi;
      else bucket.pe = bar.oi;
      oiByKey[sk] = bucket;
    }
  }

  return { premiums, strikes, oiByKey, spot };
}

function priorDayStats(
  hours: HourBar[],
): { high: number; low: number; close: number; open: number } | null {
  if (hours.length === 0) return null;
  let high = -Infinity;
  let low = Infinity;
  for (const { bar } of hours) {
    const px = bar.spot || bar.close;
    if (!px) continue;
    high = Math.max(high, px);
    low = Math.min(low, px);
  }
  if (!Number.isFinite(high) || !Number.isFinite(low)) return null;
  const open = hours[0].bar.spot || hours[0].bar.close;
  const close =
    hours[hours.length - 1].bar.spot ||
    hours[hours.length - 1].bar.close ||
    open;
  return { high, low, close, open };
}

function previousDay(days: string[], day: string) {
  const idx = days.indexOf(day);
  if (idx <= 0) return null;
  return days[idx - 1];
}

function manageIntraday(input: {
  strategy: Strategy;
  proposal: TradeProposal;
  position: OpenPosition;
  day: string;
  entryHour: number;
  indexed: IndexedSeries;
  strikeKeys: string[];
}): {
  pnlPoints: number;
  exitHour: number;
  spotExit: number;
  exitReason: string;
} {
  const { strategy, proposal, position, day, entryHour, indexed, strikeKeys } =
    input;
  const atmHours =
    hoursOnIndexed(indexed, "ATM:CE", day).length > 0
      ? hoursOnIndexed(indexed, "ATM:CE", day)
      : hoursOnIndexed(indexed, "ATM:PE", day);
  const manageHours = atmHours.filter((h) => h.hour > entryHour).sort(
    (a, b) => a.hour - b.hour,
  );

  const isDebit = proposal.netCredit < 0;
  const risk = Math.abs(proposal.netCredit) || proposal.maxLoss || 1;
  const stopLevel = isDebit
    ? -risk * (position.stopMult ?? 0.35)
    : -risk * (position.stopMult ?? 2);
  const tpLevel = position.takeProfitFrac
    ? risk * position.takeProfitFrac
    : null;

  for (const { hour, bar } of manageHours) {
    const snap = snapshotAtHour(indexed, day, hour, strikeKeys);
    const spot = snap.spot || bar.spot || bar.close;
    const pnl = strategy.settle(position, spot, snap.premiums);

    if (position.flatByHour !== undefined && hour >= position.flatByHour) {
      return {
        pnlPoints: pnl,
        exitHour: hour,
        spotExit: spot,
        exitReason: `Flat by ${position.flatByHour}:00`,
      };
    }

    if (
      position.timeStopHours !== undefined &&
      hour >= entryHour + position.timeStopHours
    ) {
      return {
        pnlPoints: pnl,
        exitHour: hour,
        spotExit: spot,
        exitReason: "Time stop",
      };
    }

    if (tpLevel !== null && pnl >= tpLevel) {
      return {
        pnlPoints: tpLevel,
        exitHour: hour,
        spotExit: spot,
        exitReason: `Take profit ${(position.takeProfitFrac! * 100).toFixed(0)}%`,
      };
    }

    if (pnl <= stopLevel) {
      return {
        pnlPoints: stopLevel,
        exitHour: hour,
        spotExit: spot,
        exitReason: isDebit
          ? `Debit stop ${(position.stopMult! * 100).toFixed(0)}%`
          : `Stop ${position.stopMult}× credit`,
      };
    }

    if (position.targetSpot !== undefined) {
      const towardDown = position.stopSpot !== undefined && position.stopSpot > position.targetSpot;
      // max pain: if dist was positive (above), target is lower
      if (towardDown && spot <= position.targetSpot) {
        return {
          pnlPoints: Math.max(pnl, 0),
          exitHour: hour,
          spotExit: spot,
          exitReason: "Hit max-pain target",
        };
      }
      if (!towardDown && position.targetSpot !== undefined && spot >= position.targetSpot) {
        return {
          pnlPoints: Math.max(pnl, 0),
          exitHour: hour,
          spotExit: spot,
          exitReason: "Hit max-pain target",
        };
      }
    }

    if (position.stopSpot !== undefined) {
      const adverseUp = position.stopSpot > (position.targetSpot ?? 0);
      if (adverseUp && spot >= position.stopSpot) {
        return {
          pnlPoints: stopLevel,
          exitHour: hour,
          spotExit: spot,
          exitReason: "Adverse spot stop",
        };
      }
      if (!adverseUp && spot <= position.stopSpot) {
        return {
          pnlPoints: stopLevel,
          exitHour: hour,
          spotExit: spot,
          exitReason: "Adverse spot stop",
        };
      }
    }
  }

  const last = manageHours[manageHours.length - 1] ?? atmHours[atmHours.length - 1];
  const snap = last
    ? snapshotAtHour(indexed, day, last.hour, strikeKeys)
    : { premiums: {}, spot: 0 };
  const spot = snap.spot || last?.bar.spot || 0;
  return {
    pnlPoints: strategy.settle(position, spot, snap.premiums),
    exitHour: last?.hour ?? entryHour,
    spotExit: spot,
    exitReason: "Session end",
  };
}

async function runTradeDays(
  strategies: Strategy[],
  instrument: IndexInstrument,
  series: Record<string, RollingBar[]>,
  widthSteps: number,
  mode: "single" | "auto",
  onProgress?: (progress: RollingProgress) => void,
): Promise<BacktestTrade[]> {
  const lot = lotSizeFor(instrument.id);
  const trades: BacktestTrade[] = [];
  const strikeKeys = atmBandKeys(4);
  const indexed = indexSeries(series);
  const days = uniqueDays(indexed);
  const atmKey = indexed["ATM:CE"] ? "ATM:CE" : "ATM:PE";
  onProgress?.({
    done: 0,
    total: days.length,
    cached: 0,
    fetched: 0,
    label: `Simulating 0/${days.length} days`,
  });

  const primary = strategies[0];
  const projectOne =
    Boolean(primary && isProjectOne(primary.id)) || mode === "auto";
  const pmOnly =
    mode === "single" && Boolean(primary && isPmSrReversal(primary.id));

  let dayIndex = 0;
  for (const day of days) {
    dayIndex += 1;
    if (dayIndex % 5 === 0) {
      onProgress?.({
        done: dayIndex,
        total: days.length,
        cached: 0,
        fetched: 0,
        label: `Simulating ${dayIndex}/${days.length} days`,
      });
      await new Promise((resolve) => setImmediate(resolve));
    }
    const prior = previousDay(days, day);
    const priorStats = prior
      ? priorDayStats(hoursOnIndexed(indexed, atmKey, prior))
      : null;
    const dayHours = hoursOnIndexed(indexed, atmKey, day);
    if (dayHours.length < 2) continue;

    const openBar = dayHours[0];
    const open = openBar.bar.spot || openBar.bar.close;

    const slots = pmOnly
      ? [14]
      : projectOne
        ? [10, 14]
        : [10];

    let busyUntil = -1;
    for (const slotHour of slots) {
      const decisionHour =
        dayHours.find((h) => h.hour === slotHour)?.hour ??
        (slotHour === 10
          ? dayHours.find((h) => h.hour >= 10)?.hour
          : dayHours.find((h) => h.hour >= 14)?.hour);
      if (decisionHour === undefined) continue;
      if (slotHour === 14 && decisionHour < 14) continue;
      if (decisionHour < busyUntil) continue;

      const snap = snapshotAtHour(indexed, day, decisionHour, strikeKeys);
      if (!snap.spot) continue;

      const maxPain = maxPainFromSnapshot(snap.strikes, snap.oiByKey);
      const walls = oiWallsFromSnapshot(snap.strikes, snap.oiByKey);
      const knownHours = dayHours.filter((h) => h.hour <= decisionHour);
      const structure = buildDayStructure({
        day,
        spot: snap.spot,
        open,
        priorHigh: priorStats?.high ?? snap.spot * 1.01,
        priorLow: priorStats?.low ?? snap.spot * 0.99,
        priorClose: priorStats?.close ?? snap.spot,
        morningBars: knownHours,
        maxPain,
        putOiSupport: walls.putSupport,
        callOiResistance: walls.callResist,
      });

      let sessionHigh = open;
      let sessionLow = open;
      for (const { bar } of knownHours) {
        const px = bar.spot || bar.close;
        if (!px) continue;
        sessionHigh = Math.max(sessionHigh, px);
        sessionLow = Math.min(sessionLow, px);
      }
      if (decisionHour >= 14) {
        structure.morningHigh = sessionHigh;
        structure.morningLow = sessionLow;
      }
      structure.sessionHigh = sessionHigh;
      structure.sessionLow = sessionLow;

      const ctx = {
        instrument,
        spot: snap.spot,
        widthSteps,
        hour: decisionHour,
        minute: decisionHour >= 14 ? 0 : undefined,
        structure,
        premiums: snap.premiums,
        strikes: snap.strikes,
        expirySession: isExpirySession(instrument.id, day, days),
      };

      let picked: {
        strategy: Strategy;
        proposal: TradeProposal;
        reason: string;
      } | null = null;

      if (mode === "auto" || projectOne) {
        picked = pickPlaybookPath(ctx, strategies.map((s) => s.id));
      } else {
        const strategy = strategies[0];
        if (strategy?.isEligible(ctx)) {
          const proposal = strategy.proposeEntry(ctx);
          if (proposal && proposalCoversCosts(proposal, instrument.id).ok) {
            picked = {
              strategy,
              proposal,
              reason: "Single strategy mode",
            };
          }
        }
      }

      if (!picked) continue;

      const defaults = positionDefaults(
        picked.strategy.id,
        ctx.expirySession,
        { credit: picked.proposal.netCredit, hour: decisionHour },
      );

      const position: OpenPosition = {
        strategyId: picked.strategy.id,
        legs: picked.proposal.legs,
        netCredit: picked.proposal.netCredit,
        width: picked.proposal.width,
        entryAt: day,
        expiryAt: day,
        entryHour: decisionHour,
        ...defaults,
      };

      const managed = manageIntraday({
        strategy: picked.strategy,
        proposal: picked.proposal,
        position,
        day,
        entryHour: decisionHour,
        indexed,
        strikeKeys,
      });

      const legCount = picked.proposal.legs.length;
      const pnlInr = managed.pnlPoints * lot;
      const brokerageInr = roundTripBrokerageInr(legCount);
      trades.push({
        strategyId: picked.strategy.id,
        strategyName: picked.strategy.name,
        entryDay: day,
        expiryDay: day,
        entryHour: decisionHour,
        exitHour: managed.exitHour,
        shortStrike: picked.proposal.primaryShortStrike,
        longStrike: picked.proposal.primaryLongStrike,
        shortSide: picked.proposal.primaryShortSide,
        longSide: picked.proposal.primaryLongSide,
        credit: picked.proposal.netCredit,
        width: picked.proposal.width,
        spotEntry: snap.spot,
        spotExpiry: managed.spotExit,
        pnlPoints: managed.pnlPoints,
        pnlInr,
        won: pnlInr - brokerageInr > 0,
        pickReason: picked.reason,
        exitReason: managed.exitReason,
        expirySession: Boolean(ctx.expirySession),
        legCount,
        brokerageInr,
        pnlAfterBrokerageInr: pnlInr - brokerageInr,
      });
      busyUntil = managed.exitHour;
    }
  }

  return trades;
}

export async function runBacktest(input: {
  instrument: IndexInstrument;
  strategyIds: string[];
  widthSteps?: number;
  months?: number;
  onProgress?: (progress: RollingProgress) => void;
}): Promise<BacktestResult> {
  const widthSteps = Math.max(
    1,
    Math.min(4, input.widthSteps ?? DEFAULT_WIDTH_STEPS),
  );
  const months = Math.max(1, Math.min(12, input.months ?? 6));
  const to = new Date();
  const from = new Date(to);
  from.setMonth(from.getMonth() - months);

  let strategies = input.strategyIds
    .map((id) => getStrategy(id))
    .filter((s): s is Strategy => Boolean(s));

  if (strategies.length === 0) {
    strategies = autoPlaybookStrategyIds()
      .map((id) => getStrategy(id))
      .filter((s): s is Strategy => Boolean(s));
  }

  const mode: "single" | "auto" = strategies.length > 1 ? "auto" : "single";

  const strikeKeys = [
    ...new Set([
      ...atmBandKeys(4),
      ...strategies.flatMap((s) => s.requiredStrikeKeys(widthSteps)),
    ]),
  ];

  // Ensure ATM for spot path
  if (!strikeKeys.includes(strikeKey(0))) strikeKeys.unshift(strikeKey(0));

  const series = await fetchRollingBundle(
    input.instrument,
    strikeKeys,
    ["CALL", "PUT"],
    from,
    to,
    input.onProgress,
  );

  const trades = await runTradeDays(
    strategies,
    input.instrument,
    series,
    widthSteps,
    mode,
    input.onProgress,
  );

  return {
    instrumentId: input.instrument.id,
    strategyIds: strategies.map((s) => s.id),
    widthSteps,
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    lotSize: lotSizeFor(input.instrument.id),
    mode,
    metrics: computeMetrics(trades),
    trades,
  };
}

/** @deprecated — weekly picker removed; use pickPlaybookPath */
export function pickOneStrategy() {
  return null;
}
