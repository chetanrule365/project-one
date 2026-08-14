import type { IndexInstrument } from "../dhan/instruments";
import {
  fetchRollingBundle,
  type RollingBar,
} from "../dhan/rolling-options";
import {
  getStrategy,
  listStrategies,
  pickPlaybookPath,
  positionDefaults,
} from "../strategies/registry";
import {
  atmBandKeys,
  buildDayStructure,
  hoursOnDay,
  isExpirySession,
  maxPainFromSnapshot,
  oiWallsFromSnapshot,
} from "../strategies/expiry-day";
import { strikeKey } from "../strategies/common";
import {
  DEFAULT_WIDTH_STEPS,
  lotSizeFor,
  type OpenPosition,
  type Strategy,
  type TradeProposal,
} from "../strategies/types";

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
};

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

function computeMetrics(trades: BacktestTrade[]): BacktestMetrics {
  const wins = trades.filter((t) => t.won).length;
  const losses = trades.length - wins;
  const totalPnlPoints = trades.reduce((s, t) => s + t.pnlPoints, 0);
  const totalPnlInr = trades.reduce((s, t) => s + t.pnlInr, 0);
  const grossProfit = trades
    .filter((t) => t.pnlInr > 0)
    .reduce((s, t) => s + t.pnlInr, 0);
  const grossLoss = Math.abs(
    trades.filter((t) => t.pnlInr < 0).reduce((s, t) => s + t.pnlInr, 0),
  );

  let equity = 0;
  let peak = 0;
  let maxDrawdownInr = 0;
  for (const trade of trades) {
    equity += trade.pnlInr;
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
  };
}

function uniqueDays(series: Record<string, RollingBar[]>) {
  const set = new Set<string>();
  for (const bars of Object.values(series)) {
    for (const bar of bars) {
      const day = new Date(bar.timestamp * 1000).toLocaleDateString("en-CA", {
        timeZone: "Asia/Kolkata",
      });
      set.add(day);
    }
  }
  return [...set].sort();
}

function snapshotAtHour(
  series: Record<string, RollingBar[]>,
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
      const hours = hoursOnDay(series[key] ?? [], day);
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
  atmBars: RollingBar[],
  day: string,
): { high: number; low: number; close: number; open: number } | null {
  const hours = hoursOnDay(atmBars, day);
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
  series: Record<string, RollingBar[]>;
  strikeKeys: string[];
}): {
  pnlPoints: number;
  exitHour: number;
  spotExit: number;
  exitReason: string;
} {
  const { strategy, proposal, position, day, entryHour, series, strikeKeys } =
    input;
  const atmHours = hoursOnDay(series["ATM:CE"] ?? series["ATM:PE"] ?? [], day);
  const manageHours = atmHours.filter((h) => h.hour > entryHour).sort(
    (a, b) => a.hour - b.hour,
  );

  const isDebit = proposal.netCredit < 0;
  const risk = Math.abs(proposal.netCredit) || proposal.maxLoss || 1;
  const stopLevel = isDebit
    ? -risk * (position.stopMult ?? 0.35)
    : -risk * (position.stopMult ?? 2);
  const tpLevel =
    position.takeProfitFrac && proposal.maxProfit > 0
      ? proposal.maxProfit * position.takeProfitFrac
      : null;

  for (const { hour, bar } of manageHours) {
    const snap = snapshotAtHour(series, day, hour, strikeKeys);
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
    ? snapshotAtHour(series, day, last.hour, strikeKeys)
    : { premiums: {}, spot: 0 };
  const spot = snap.spot || last?.bar.spot || 0;
  return {
    pnlPoints: strategy.settle(position, spot, snap.premiums),
    exitHour: last?.hour ?? entryHour,
    spotExit: spot,
    exitReason: "Session end",
  };
}

function runTradeDays(
  strategies: Strategy[],
  instrument: IndexInstrument,
  series: Record<string, RollingBar[]>,
  widthSteps: number,
  days: string[],
  mode: "single" | "auto",
): BacktestTrade[] {
  const lot = lotSizeFor(instrument.id);
  const trades: BacktestTrade[] = [];
  const strikeKeys = atmBandKeys(4);
  const atmSeries = series["ATM:CE"] ?? series["ATM:PE"] ?? [];

  for (const day of days) {
    const prior = previousDay(days, day);
    const priorStats = prior ? priorDayStats(atmSeries, prior) : null;
    const dayHours = hoursOnDay(atmSeries, day);
    if (dayHours.length < 2) continue;

    const openBar = dayHours[0];
    const open = openBar.bar.spot || openBar.bar.close;

    // Decision hour: 10:00 preferred
    const decisionHour = dayHours.find((h) => h.hour >= 10)?.hour ?? dayHours[1]?.hour;
    if (decisionHour === undefined) continue;

    const snap = snapshotAtHour(series, day, decisionHour, strikeKeys);
    if (!snap.spot) continue;

    const maxPain = maxPainFromSnapshot(snap.strikes, snap.oiByKey);
    const walls = oiWallsFromSnapshot(snap.strikes, snap.oiByKey);
    const structure = buildDayStructure({
      day,
      spot: snap.spot,
      open,
      priorHigh: priorStats?.high ?? snap.spot * 1.01,
      priorLow: priorStats?.low ?? snap.spot * 0.99,
      priorClose: priorStats?.close ?? snap.spot,
      morningBars: dayHours,
      maxPain,
      putOiSupport: walls.putSupport,
      callOiResistance: walls.callResist,
    });

    const ctx = {
      instrument,
      spot: snap.spot,
      widthSteps,
      hour: decisionHour,
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

    if (mode === "auto") {
      picked = pickPlaybookPath(ctx, strategies.map((s) => s.id));
    } else {
      const strategy = strategies[0];
      if (strategy?.isEligible(ctx)) {
        const proposal = strategy.proposeEntry(ctx);
        if (proposal) {
          picked = {
            strategy,
            proposal,
            reason: "Single strategy mode",
          };
        }
      }
    }

    if (!picked) continue;

    const defaults = positionDefaults(picked.strategy.id, ctx.expirySession);
    let targetSpot: number | undefined;
    let stopSpot: number | undefined;
    if (picked.strategy.id === "MAX_PAIN_REV" && structure.distToMaxPain !== null) {
      targetSpot = snap.spot - structure.distToMaxPain / 2;
      stopSpot = snap.spot + Math.sign(structure.distToMaxPain) * 50;
    }

    const position: OpenPosition = {
      strategyId: picked.strategy.id,
      legs: picked.proposal.legs,
      netCredit: picked.proposal.netCredit,
      width: picked.proposal.width,
      entryAt: day,
      expiryAt: day,
      entryHour: decisionHour,
      ...defaults,
      targetSpot,
      stopSpot,
    };

    const managed = manageIntraday({
      strategy: picked.strategy,
      proposal: picked.proposal,
      position,
      day,
      entryHour: decisionHour,
      series,
      strikeKeys,
    });

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
      pnlInr: managed.pnlPoints * lot,
      won: managed.pnlPoints > 0,
      pickReason: picked.reason,
      exitReason: managed.exitReason,
    });
  }

  return trades;
}

export async function runBacktest(input: {
  instrument: IndexInstrument;
  strategyIds: string[];
  widthSteps?: number;
  months?: number;
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
    strategies = listStrategies();
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
  );

  const days = uniqueDays(series);
  const trades = runTradeDays(
    strategies,
    input.instrument,
    series,
    widthSteps,
    days,
    mode,
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
