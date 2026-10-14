import type { IndexInstrument } from "../dhan/instruments";
import { loadSweepBars } from "../dhan/intraday-5m.server";
import {
  fetchRollingBundle,
  type RollingBar,
  type RollingProgress,
} from "../dhan/rolling-options.server";
import {
  detectLiquiditySweep,
  SWEEP_FADE_ID,
  sweepBuffer,
  sweepFadeStrategy,
  type SweepBar,
} from "../strategies/liquidity-sweep";
import {
  autoPlaybookStrategyIds,
  getStrategy,
  pickPlaybookEntries,
  positionDefaults,
} from "../strategies/registry";
import { isProjectOne, projectOneStrategy } from "../strategies/project-one";
import { isPmSrReversal } from "../strategies/pm-sr-reversal";
import {
  EXPIRY_TREND_END_MIN,
  EXPIRY_TREND_ID,
  EXPIRY_TREND_START_MIN,
} from "../strategies/expiry-trend-credit";
import {
  atmBandKeys,
  buildDayStructure,
  isExpirySession,
  istParts,
  maxPainFromSnapshot,
  oiWallsFromSnapshot,
  orbBreakBufferPts,
} from "../strategies/expiry-day";
import { strikeKey } from "../strategies/common";
import {
  proposalCoversCosts,
  roundTripBrokerageInr,
} from "../strategies/cost-filter";
import { marginRequiredInr } from "./margin";
import { SimWallet } from "./wallet";
import {
  computeMetrics,
  type BacktestResult,
  type BacktestTrade,
} from "./backtest-shared";
import {
  DEFAULT_ORB_WINDOW,
  DEFAULT_WIDTH_STEPS,
  inSweepEntryWindow,
  lotSizeFor,
  type OrbWindow,
  type OpenPosition,
  type Strategy,
  type TradeProposal,
} from "../strategies/types";

type HourBar = { hour: number; bar: RollingBar };
type ClockBar = { hour: number; minute: number; bar: RollingBar };
type IndexedSeries = Record<string, Map<string, ClockBar[]>>;

function clockMinutes(hour: number, minute: number) {
  return hour * 60 + minute;
}

function clockLabel(hour: number, minute: number) {
  return `${hour}:${String(minute).padStart(2, "0")}`;
}

function indexSeries(series: Record<string, RollingBar[]>): IndexedSeries {
  const indexed: IndexedSeries = {};
  for (const [key, bars] of Object.entries(series)) {
    const byDay = new Map<string, Map<number, ClockBar>>();
    for (const bar of bars) {
      const { day, hour, minute } = istParts(bar.timestamp);
      let slots = byDay.get(day);
      if (!slots) {
        slots = new Map();
        byDay.set(day, slots);
      }
      slots.set(clockMinutes(hour, minute), { hour, minute, bar });
    }
    const dayMap = new Map<string, ClockBar[]>();
    for (const [day, slots] of byDay) {
      dayMap.set(
        day,
        [...slots.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([, row]) => row),
      );
    }
    indexed[key] = dayMap;
  }
  return indexed;
}

/** One spot per hour so the opening-range check still means the 9:xx hour. */
function hourlyBars(bars: ClockBar[]): HourBar[] {
  const byHour = new Map<number, RollingBar>();
  for (const row of bars) byHour.set(row.hour, row.bar);
  return [...byHour.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([hour, bar]) => ({ hour, bar }));
}

/** Decision clocks for the morning loop (IST). */
function morningDecisionSlots(
  dayClock: ClockBar[],
  opts: {
    wantOrb: boolean;
    pmOnly: boolean;
    orbWindow: OrbWindow;
    wantExpiryTrend: boolean;
  },
): Array<{ hour: number; minute: number }> {
  if (opts.pmOnly) return [{ hour: 14, minute: 0 }];
  // Project One decides on the 10:00 and 11:00 prints.
  const mins = new Set<number>([10 * 60, 11 * 60]);
  for (const row of dayClock) {
    const t = clockMinutes(row.hour, row.minute);
    // ORB breaks rarely land on an hour print — walk every 5m bar in the window.
    if (opts.wantOrb && t >= opts.orbWindow.startMin && t < opts.orbWindow.endMin) {
      mins.add(t);
    }
    if (
      opts.wantExpiryTrend &&
      t >= EXPIRY_TREND_START_MIN &&
      t < EXPIRY_TREND_END_MIN
    ) {
      mins.add(t);
    }
  }
  return [...mins]
    .sort((a, b) => a - b)
    .map((t) => ({ hour: Math.floor(t / 60), minute: t % 60 }));
}

/** Align ORB flags with live: one-sided break vs open + buffer, skip two-sided chop. */
function applyBacktestOrbFlags(
  structure: ReturnType<typeof buildDayStructure>,
  open: number,
  knownClock: ClockBar[],
  spot: number,
  instrumentId: string,
) {
  const buf = orbBreakBufferPts(instrumentId, spot || open);
  let sessionHigh = open;
  let sessionLow = open;
  for (const { bar } of knownClock) {
    const px = bar.spot || bar.close;
    if (!px) continue;
    sessionHigh = Math.max(sessionHigh, px);
    sessionLow = Math.min(sessionLow, px);
  }
  const chop =
    sessionHigh >= open + buf * 0.6 && sessionLow <= open - buf * 0.6;
  let orbBrokenUp = !chop && spot >= open + buf;
  let orbBrokenDown = !chop && spot <= open - buf;
  if (orbBrokenUp && orbBrokenDown) {
    orbBrokenUp = false;
    orbBrokenDown = false;
  }
  structure.orbBrokenUp = orbBrokenUp;
  structure.orbBrokenDown = orbBrokenDown;
  structure.sessionHigh = sessionHigh;
  structure.sessionLow = sessionLow;
  return structure;
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

function snapshotAt(
  indexed: IndexedSeries,
  day: string,
  hour: number,
  minute: number,
  strikeKeys: string[],
) {
  const premiums: Record<string, number> = {};
  const strikes: Record<string, number> = {};
  const oiByKey: Record<string, { ce: number; pe: number }> = {};
  let spot = 0;

  for (const sk of strikeKeys) {
    for (const right of ["CE", "PE"] as const) {
      const key = `${sk}:${right}`;
      const slots = hoursOnIndexed(indexed, key, day);
      const target = clockMinutes(hour, minute);
      const bar = [...slots]
        .reverse()
        .find((row) => clockMinutes(row.hour, row.minute) <= target)?.bar;
      if (!bar) continue;
      premiums[key] = bar.close;
      // ATM-relative keys roll with spot; held legs must mark at their own strike.
      if (bar.strike > 0) premiums[`${bar.strike}:${right}`] = bar.close;
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

/**
 * Marks keyed by absolute strike for each held leg. A leg that has drifted outside the
 * cached ATM band is extrapolated from the two nearest cached strikes, floored at intrinsic.
 */
function strikeMarks(
  premiums: Record<string, number>,
  legs: OpenPosition["legs"],
  spot: number,
) {
  const marks: Record<string, number> = {};
  for (const leg of legs) {
    const key = `${leg.strike}:${leg.right}`;
    if (premiums[key] !== undefined) {
      marks[key] = premiums[key];
      continue;
    }
    const known = Object.entries(premiums)
      .filter(([k]) => /^\d/.test(k) && k.endsWith(`:${leg.right}`))
      .map(([k, px]) => ({ strike: Number(k.split(":")[0]), px }))
      .sort((a, b) => Math.abs(a.strike - leg.strike) - Math.abs(b.strike - leg.strike));
    const intrinsicPx =
      leg.right === "CE" ? Math.max(0, spot - leg.strike) : Math.max(0, leg.strike - spot);
    const [a, b] = known;
    if (!a || !b || a.strike === b.strike) {
      marks[key] = intrinsicPx;
      continue;
    }
    const slope = (a.px - b.px) / (a.strike - b.strike);
    marks[key] = Math.max(intrinsicPx, 0.05, a.px + slope * (leg.strike - a.strike));
  }
  return marks;
}

function priorDayStats(
  hours: Array<{ bar: RollingBar }>,
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
  entryMinute: number;
  indexed: IndexedSeries;
  strikeKeys: string[];
}): {
  pnlPoints: number;
  exitHour: number;
  exitMinute: number;
  spotExit: number;
  exitReason: string;
} {
  const {
    strategy,
    proposal,
    position,
    day,
    entryHour,
    entryMinute,
    indexed,
    strikeKeys,
  } = input;
  const entryClock = clockMinutes(entryHour, entryMinute);
  const atmBars =
    hoursOnIndexed(indexed, "ATM:CE", day).length > 0
      ? hoursOnIndexed(indexed, "ATM:CE", day)
      : hoursOnIndexed(indexed, "ATM:PE", day);
  const manageBars = atmBars
    .filter((row) => clockMinutes(row.hour, row.minute) > entryClock)
    .sort(
      (a, b) =>
        clockMinutes(a.hour, a.minute) - clockMinutes(b.hour, b.minute),
    );

  const isDebit = proposal.netCredit < 0;
  const risk = Math.abs(proposal.netCredit) || proposal.maxLoss || 1;
  const stopLevel = isDebit
    ? -risk * (position.stopMult ?? 0.35)
    : -risk * (position.stopMult ?? 2);
  const tpLevel = position.takeProfitFrac
    ? risk * position.takeProfitFrac
    : null;

  for (const { hour, minute, bar } of manageBars) {
    const snap = snapshotAt(indexed, day, hour, minute, strikeKeys);
    const spot = snap.spot || bar.spot || bar.close;
    const pnl = strategy.settle(
      position,
      spot,
      strikeMarks(snap.premiums, position.legs, spot),
    );
    const flatHour = position.flatByHour;
    const flatMinute = position.flatByMinute ?? 0;

    if (
      flatHour !== undefined &&
      clockMinutes(hour, minute) >= clockMinutes(flatHour, flatMinute)
    ) {
      return {
        pnlPoints: pnl,
        exitHour: hour,
        exitMinute: minute,
        spotExit: spot,
        exitReason: `Flat by ${clockLabel(flatHour, flatMinute)}`,
      };
    }

    if (
      position.timeStopHours !== undefined &&
      hour >= entryHour + position.timeStopHours
    ) {
      return {
        pnlPoints: pnl,
        exitHour: hour,
        exitMinute: minute,
        spotExit: spot,
        exitReason: "Time stop",
      };
    }

    if (tpLevel !== null && pnl >= tpLevel) {
      return {
        pnlPoints: tpLevel,
        exitHour: hour,
        exitMinute: minute,
        spotExit: spot,
        exitReason: `Take profit ${(position.takeProfitFrac! * 100).toFixed(0)}%`,
      };
    }

    if (position.reclaimSpot !== undefined && position.reclaimDir) {
      const gaveBack =
        position.reclaimDir === "below"
          ? spot <= position.reclaimSpot
          : spot >= position.reclaimSpot;
      if (gaveBack) {
        return {
          pnlPoints: pnl,
          exitHour: hour,
          exitMinute: minute,
          spotExit: spot,
          exitReason: "Gave back the level",
        };
      }
    }

    if (pnl <= stopLevel) {
      return {
        pnlPoints: stopLevel,
        exitHour: hour,
        exitMinute: minute,
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
          exitMinute: minute,
          spotExit: spot,
          exitReason: "Hit max-pain target",
        };
      }
      if (!towardDown && position.targetSpot !== undefined && spot >= position.targetSpot) {
        return {
          pnlPoints: Math.max(pnl, 0),
          exitHour: hour,
          exitMinute: minute,
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
          exitMinute: minute,
          spotExit: spot,
          exitReason: "Adverse spot stop",
        };
      }
      if (!adverseUp && spot <= position.stopSpot) {
        return {
          pnlPoints: stopLevel,
          exitHour: hour,
          exitMinute: minute,
          spotExit: spot,
          exitReason: "Adverse spot stop",
        };
      }
    }
  }

  const last = manageBars[manageBars.length - 1] ?? atmBars[atmBars.length - 1];
  const snap = last
    ? snapshotAt(indexed, day, last.hour, last.minute, strikeKeys)
    : { premiums: {}, spot: 0 };
  const spot = snap.spot || last?.bar.spot || 0;
  return {
    pnlPoints: strategy.settle(
      position,
      spot,
      strikeMarks(snap.premiums, position.legs, spot),
    ),
    exitHour: last?.hour ?? entryHour,
    exitMinute: last?.minute ?? entryMinute,
    spotExit: spot,
    exitReason: "Session end",
  };
}

type DayFill = {
  entryMin: number;
  exitMin: number;
  marginInr: number;
  pnlAfterBrokerageInr: number;
  trade: BacktestTrade;
};

async function runTradeDays(
  strategies: Strategy[],
  instrument: IndexInstrument,
  series: Record<string, RollingBar[]>,
  widthSteps: number,
  mode: "single" | "auto",
  onProgress?: (progress: RollingProgress) => void,
  sweepBars: SweepBar[] = [],
  orbWindow: OrbWindow = DEFAULT_ORB_WINDOW,
): Promise<{
  trades: BacktestTrade[];
  skippedForMargin: number;
  peakLockedInr: number;
}> {
  const lot = lotSizeFor(instrument.id);
  const trades: BacktestTrade[] = [];
  const wallet = new SimWallet();
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
  const projectOneOnly =
    mode === "single" && Boolean(primary && isProjectOne(primary.id));
  const pmOnly =
    mode === "single" && Boolean(primary && isPmSrReversal(primary.id));
  const wantOrb =
    mode === "auto" || strategies.some((strategy) => strategy.id === "ORB_ATM");
  const wantExpiryTrend =
    mode === "auto" ||
    strategies.some((strategy) => strategy.id === EXPIRY_TREND_ID);
  // Sweep only when Auto/Both, or Sweep is explicitly selected.
  const includeSweep =
    mode === "auto" || strategies.some((strategy) => strategy.id === SWEEP_FADE_ID);

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
    const dayClock = hoursOnIndexed(indexed, atmKey, day);
    const dayHours = hourlyBars(dayClock);
    if (dayHours.length < 2) continue;

    const openBar = dayClock[0] ?? dayHours[0];
    const open = openBar.bar.spot || openBar.bar.close;

    const slots = morningDecisionSlots(dayClock, {
      wantOrb,
      pmOnly,
      orbWindow,
      wantExpiryTrend,
    });
    const fills: DayFill[] = [];

    let busyUntilMin = -1;
    let expiryTrendTaken = false;
    for (const slot of slots) {
      const decisionHour = slot.hour;
      const decisionMinute = slot.minute;
      const decisionMin = clockMinutes(decisionHour, decisionMinute);
      if (decisionMin < busyUntilMin) continue;

      const snap = snapshotAt(
        indexed,
        day,
        decisionHour,
        decisionMinute,
        strikeKeys,
      );
      if (!snap.spot) continue;

      const maxPain = maxPainFromSnapshot(snap.strikes, snap.oiByKey);
      const walls = oiWallsFromSnapshot(snap.strikes, snap.oiByKey);
      const knownClock = dayClock.filter(
        (row) =>
          clockMinutes(row.hour, row.minute) <=
          clockMinutes(decisionHour, decisionMinute),
      );
      const knownHours = hourlyBars(knownClock);
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

      if (pmOnly) {
        let sessionHigh = open;
        let sessionLow = open;
        for (const { bar } of knownClock) {
          const px = bar.spot || bar.close;
          if (!px) continue;
          sessionHigh = Math.max(sessionHigh, px);
          sessionLow = Math.min(sessionLow, px);
        }
        structure.morningHigh = sessionHigh;
        structure.morningLow = sessionLow;
        structure.sessionHigh = sessionHigh;
        structure.sessionLow = sessionLow;
      } else {
        applyBacktestOrbFlags(
          structure,
          open,
          knownClock,
          snap.spot,
          instrument.id,
        );
      }

      const ctx = {
        instrument,
        spot: snap.spot,
        widthSteps,
        hour: decisionHour,
        minute: decisionMinute,
        structure,
        premiums: snap.premiums,
        strikes: snap.strikes,
        expirySession: isExpirySession(instrument.id, day, days),
        orbWindow,
      };

      let picked: {
        strategy: Strategy;
        proposal: TradeProposal;
        reason: string;
      } | null = null;

      if (mode === "auto") {
        // Same morning split as live playbook: quiet → Project One, ORB break → ORB ATM.
        // Sweep has its own entry path below.
        const morning = pickPlaybookEntries(ctx).find(
          (p) => p.strategy.id !== SWEEP_FADE_ID,
        );
        if (morning) {
          const costOk =
            isProjectOne(morning.strategy.id) ||
            proposalCoversCosts(morning.proposal, instrument.id).ok;
          if (costOk) picked = morning;
        }
      } else if (projectOneOnly) {
        if (projectOneStrategy.isEligible(ctx)) {
          const proposal = projectOneStrategy.proposeEntry(ctx);
          if (proposal) {
            picked = {
              strategy: projectOneStrategy,
              proposal,
              reason: proposal.description,
            };
          }
        }
      } else {
        const strategy = strategies[0];
        if (strategy?.isEligible(ctx)) {
          const proposal = strategy.proposeEntry(ctx);
          if (proposal && proposalCoversCosts(proposal, instrument.id).ok) {
            picked = {
              strategy,
              proposal,
              reason: proposal.description || "Single strategy mode",
            };
          }
        }
      }

      if (!picked) continue;
      // Live paper takes Expiry Trend at most once per session.
      if (picked.strategy.id === EXPIRY_TREND_ID) {
        if (expiryTrendTaken) continue;
        expiryTrendTaken = true;
      }

      const defaults = {
        ...positionDefaults(picked.strategy.id, ctx.expirySession, {
          credit: picked.proposal.netCredit,
          hour: decisionHour,
        }),
      };
      if (picked.strategy.id === "ORB_ATM") {
        defaults.flatByHour = Math.floor(orbWindow.flatMin / 60);
        defaults.flatByMinute = orbWindow.flatMin % 60;
        if (orbWindow.side === "sell") {
          defaults.stopMult = orbWindow.stopMult ?? 1;
          defaults.takeProfitFrac = orbWindow.takeProfitFrac ?? 0.5;
        } else {
          if (orbWindow.stopMult !== undefined) defaults.stopMult = orbWindow.stopMult;
          if (orbWindow.takeProfitFrac !== undefined) {
            defaults.takeProfitFrac = orbWindow.takeProfitFrac;
          }
        }
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
      };

      const managed = manageIntraday({
        strategy: picked.strategy,
        proposal: picked.proposal,
        position,
        day,
        entryHour: decisionHour,
        entryMinute: decisionMinute,
        indexed,
        strikeKeys,
      });

      const legCount = picked.proposal.legs.length;
      const pnlInr = managed.pnlPoints * lot;
      const brokerageInr = roundTripBrokerageInr(legCount);
      const marginInr = marginRequiredInr({
        instrumentId: instrument.id,
        strategyId: picked.strategy.id,
        credit: picked.proposal.netCredit,
        width: picked.proposal.width,
        spot: snap.spot,
        legCount,
      });
      const exitMinute = managed.exitMinute ?? 0;
      fills.push({
        entryMin: decisionMin,
        exitMin: clockMinutes(managed.exitHour, exitMinute),
        marginInr,
        pnlAfterBrokerageInr: pnlInr - brokerageInr,
        trade: {
          strategyId: picked.strategy.id,
          strategyName: picked.strategy.name,
          entryDay: day,
          expiryDay: day,
          entryHour: decisionHour,
          entryMinute: decisionMinute,
          exitHour: managed.exitHour,
          exitMinute,
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
          marginInr,
        },
      });
      busyUntilMin = clockMinutes(managed.exitHour, exitMinute);
    }

    if (!pmOnly && includeSweep) {
      const dayTape = sweepBars.filter((bar) => bar.day === day);
      const snap10 = snapshotAt(indexed, day, 10, 0, strikeKeys);
      const walls10 = oiWallsFromSnapshot(snap10.strikes, snap10.oiByKey);
      const signal =
        dayTape.length > 0
          ? detectLiquiditySweep({
              bars: dayTape,
              priorHigh: priorStats?.high ?? 0,
              priorLow: priorStats?.low ?? 0,
              putOi: walls10.putSupport,
              callOi: walls10.callResist,
              buffer: sweepBuffer(instrument.id),
            })
          : null;
      const entryTotal = signal
        ? signal.hour * 60 + signal.minute + 5
        : 0;
      const entryHour = Math.floor(entryTotal / 60);
      const entryMinute = entryTotal % 60;
      const snap =
        signal && inSweepEntryWindow(entryHour, entryMinute)
          ? snapshotAt(indexed, day, entryHour, entryMinute, strikeKeys)
          : null;
      if (signal && snap?.spot) {
        const knownHours = hourlyBars(
          dayClock.filter(
            (row) =>
              clockMinutes(row.hour, row.minute) <=
              clockMinutes(entryHour, entryMinute),
          ),
        );
        const maxPain = maxPainFromSnapshot(snap.strikes, snap.oiByKey);
        const walls = oiWallsFromSnapshot(snap.strikes, snap.oiByKey);
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
        const ctx = {
          instrument,
          spot: snap.spot,
          widthSteps,
          hour: entryHour,
          minute: entryMinute,
          structure,
          premiums: snap.premiums,
          strikes: snap.strikes,
          expirySession: isExpirySession(instrument.id, day, days),
          sweep: signal,
        };
        const proposal = sweepFadeStrategy.isEligible(ctx)
          ? sweepFadeStrategy.proposeEntry(ctx)
          : null;
        if (proposal && proposalCoversCosts(proposal, instrument.id).ok) {
          const defaults = positionDefaults(
            sweepFadeStrategy.id,
            ctx.expirySession,
            {
              credit: proposal.netCredit,
              hour: entryHour,
              sweep: signal,
            },
          );
          const position: OpenPosition = {
            strategyId: sweepFadeStrategy.id,
            legs: proposal.legs,
            netCredit: proposal.netCredit,
            width: proposal.width,
            entryAt: day,
            expiryAt: day,
            entryHour,
            ...defaults,
          };
          const managed = manageIntraday({
            strategy: sweepFadeStrategy,
            proposal,
            position,
            day,
            entryHour,
            entryMinute,
            indexed,
            strikeKeys,
          });
          const legCount = proposal.legs.length;
          const pnlInr = managed.pnlPoints * lot;
          const brokerageInr = roundTripBrokerageInr(legCount);
          const marginInr = marginRequiredInr({
            instrumentId: instrument.id,
            strategyId: sweepFadeStrategy.id,
            credit: proposal.netCredit,
            width: proposal.width,
            spot: snap.spot,
            legCount,
          });
          const exitMinute = managed.exitMinute ?? 0;
          fills.push({
            entryMin: clockMinutes(entryHour, entryMinute),
            exitMin: clockMinutes(managed.exitHour, exitMinute),
            marginInr,
            pnlAfterBrokerageInr: pnlInr - brokerageInr,
            trade: {
              strategyId: sweepFadeStrategy.id,
              strategyName: sweepFadeStrategy.name,
              entryDay: day,
              expiryDay: day,
              entryHour,
              entryMinute,
              exitHour: managed.exitHour,
              exitMinute,
              shortStrike: proposal.primaryShortStrike,
              longStrike: proposal.primaryLongStrike,
              shortSide: proposal.primaryShortSide,
              longSide: proposal.primaryLongSide,
              credit: proposal.netCredit,
              width: proposal.width,
              spotEntry: snap.spot,
              spotExpiry: managed.spotExit,
              pnlPoints: managed.pnlPoints,
              pnlInr,
              won: pnlInr - brokerageInr > 0,
              pickReason: proposal.description,
              exitReason: managed.exitReason,
              expirySession: Boolean(ctx.expirySession),
              legCount,
              brokerageInr,
              pnlAfterBrokerageInr: pnlInr - brokerageInr,
              marginInr,
            },
          });
        }
      }
    }

    fills.sort((a, b) => a.entryMin - b.entryMin);
    const dayBase = dayIndex * 20_000;
    for (const fill of fills) {
      if (
        !wallet.tryOpen(
          dayBase + fill.entryMin,
          fill.marginInr,
          dayBase + fill.exitMin,
          fill.pnlAfterBrokerageInr,
        )
      ) {
        continue;
      }
      trades.push(fill.trade);
    }
  }

  wallet.settle();
  return {
    trades,
    skippedForMargin: wallet.skipped,
    peakLockedInr: wallet.peakLockedInr,
  };
}

export async function runBacktest(input: {
  instrument: IndexInstrument;
  strategyIds: string[];
  widthSteps?: number;
  months?: number;
  orbWindow?: OrbWindow;
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
  const wantSweep =
    mode === "auto" || strategies.some((strategy) => strategy.id === SWEEP_FADE_ID);

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
    5,
  );

  let sweepBars: SweepBar[] = [];
  if (wantSweep) {
    input.onProgress?.({
      done: 0,
      total: 1,
      cached: 0,
      fetched: 0,
      label: "Reading 5-minute sweep tape",
    });
    try {
      sweepBars = await loadSweepBars(input.instrument, from, to);
    } catch (error) {
      console.error("[sweep] 5-minute tape unavailable", error);
    }
  }

  const simulated = await runTradeDays(
    strategies,
    input.instrument,
    series,
    widthSteps,
    mode,
    input.onProgress,
    sweepBars,
    input.orbWindow,
  );

  return {
    instrumentId: input.instrument.id,
    strategyIds: strategies.map((s) => s.id),
    widthSteps,
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    lotSize: lotSizeFor(input.instrument.id),
    mode,
    metrics: computeMetrics(simulated.trades, input.instrument.id, {
      skippedForMargin: simulated.skippedForMargin,
      peakLockedInr: simulated.peakLockedInr,
    }),
    trades: simulated.trades,
  };
}

/** @deprecated — weekly picker removed; use pickPlaybookPath */
export function pickOneStrategy() {
  return null;
}
