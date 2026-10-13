import { getIndexByParam, INDEX_INSTRUMENTS } from "../dhan/instruments";
import { loadOptionChainPage } from "../dhan/option-chain";
import { fetchIndexQuotes, fetchPriorSessionStats } from "../dhan/quotes";
import {
  getStrategy,
  pickPlaybookEntries,
} from "../strategies/registry";
import { isProjectOne, PROJECT_ONE_ID } from "../strategies/project-one";
import {
  buildLiveDayStructure,
  chainAroundAtm,
  computeMaxPain,
  isIstTradingWeekday,
  liveExpirySession,
  nextExpiryDateIst,
  oiWalls,
  todayIst,
} from "../strategies/expiry-day";
import {
  DEFAULT_WIDTH_STEPS,
  inMorningEntryWindow,
  inSweepEntryWindow,
  istClock,
  lotSizeFor,
  MORNING_PLAYBOOK_WINDOW,
  type OpenPosition,
  type Strategy,
} from "../strategies/types";
import { loadTodaySweepBars } from "../dhan/intraday-5m";
import {
  detectLiquiditySweep,
  SWEEP_FADE_ID,
  sweepBuffer,
  sweepIsFresh,
  sweepPositionExtras,
} from "../strategies/liquidity-sweep";
import { decidePaperExit } from "./paper-exit";
import {
  closeTrade,
  getActiveRun,
  insertOpenTrade,
  listOpenTrades,
  listActiveRuns,
  listAllPaperRuns,
  listAllPaperTrades,
  listTradesForRun,
  patchTradeMark,
  startPaperRun,
  type PaperRun,
  type PaperTrade,
} from "./paper-store";
import {
  exitPremiumsFromChain,
} from "./paper-position";
import { marginRequiredInr } from "./margin";
import {
  canAffordMargin,
  walletFromPaperTrades,
  type WalletSnapshot,
} from "./wallet";


function hourIst() {
  return istClock().hour;
}

function minuteIst() {
  return istClock().minute;
}

/**
 * Capital blocked in ₹ for 1 lot.
 * Buys: premium paid. 4-leg IC: Dhan SPAN (~4.4% of notional).
 * 2-leg credits: defined-risk max loss (width − credit).
 */
export function marginConsumedInr(trade: {
  instrument_id?: string;
  strategy_id: string;
  credit: number;
  width: number;
  spot_entry?: number;
  legs?: Array<unknown>;
  legCount?: number;
}) {
  return marginRequiredInr({
    instrumentId: trade.instrument_id,
    strategyId: trade.strategy_id,
    credit: trade.credit,
    width: trade.width,
    spot: trade.spot_entry,
    legCount: trade.legCount ?? trade.legs?.length,
  });
}

export function currentMonthIst() {
  return todayIst().slice(0, 7);
}

export function entryMonthIst(entryAt: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(entryAt)) return entryAt.slice(0, 7);
  const date = new Date(entryAt);
  if (!Number.isFinite(date.getTime())) return entryAt.slice(0, 7);
  return date
    .toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })
    .slice(0, 7);
}

export function formatMonthLabel(month: string) {
  const date = new Date(`${month}-01T12:00:00+05:30`);
  if (!Number.isFinite(date.getTime())) return month;
  return date.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    month: "long",
    year: "numeric",
  });
}
 
export function getPaperSnapshot() {
  // repairStoredPaperPnls() removed — ensure stored pnls are valid elsewhere
  const activeRuns = listActiveRuns();
  const runs = listAllPaperRuns();
  const runById = new Map(runs.map((run) => [run.id, run]));
  const activeIds = new Set(activeRuns.map((run) => run.id));
  const trades = listAllPaperTrades()
    .map((trade) => {
      const instrumentId = runById.get(trade.run_id)?.instrument_id;
      return {
        ...trade,
        instrument_id: instrumentId,
        margin_inr: marginConsumedInr({
          ...trade,
          instrument_id: instrumentId,
        }),
      };
    })
    .sort((a, b) => {
      const aActive = activeIds.has(a.run_id) ? 0 : 1;
      const bActive = activeIds.has(b.run_id) ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return b.id - a.id;
    });
  return {
    activeRuns,
    active: activeRuns[0],
    runs,
    trades,
    wallet: walletFromPaperTrades(trades),
  };
}

/** Shared ₹1 lakh paper wallet across all always-on index runs. */
export function getPaperWallet(): WalletSnapshot {
  return getPaperSnapshot().wallet;
}

/**
 * Open paper trades with their latest live (unrealized) mark-to-market P&L.
 * Marks are refreshed by the paper worker each sync tick.
 */
export function getLivePaperTrades() {
  const snapshot = getPaperSnapshot();
  const trades = snapshot.trades.filter((trade) => trade.status === "open");
  const totalPnlInr = trades.reduce(
    (sum, trade) => sum + (trade.mark_pnl_inr ?? 0),
    0,
  );
  const asOf =
    trades
      .map((trade) => trade.mark_at)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;
  return { trades, totalPnlInr, asOf, wallet: snapshot.wallet };
}

/** Always-on paper: one Project One run per index. No start/stop required. */
export function ensureAlwaysOnPaperRuns() {
  const active = listActiveRuns();
  for (const instrument of INDEX_INSTRUMENTS) {
    if (!active.some((run) => run.instrument_id === instrument.id)) {
      startPaperRun({
        instrumentId: instrument.id,
        strategyId: PROJECT_ONE_ID,
        widthSteps: DEFAULT_WIDTH_STEPS,
      });
    }
  }
}

export function startPaper(input: {
  instrumentId: string;
  strategyId: string;
  widthSteps: number;
}) {
  const run = startPaperRun(input);
  void import("./paper-worker").then((m) => m.ensurePaperWorker());
  return run;
}

 
function resolveStrategies(strategyId: string): Strategy[] {
  const strategy = getStrategy(
    isProjectOne(strategyId) ? PROJECT_ONE_ID : strategyId,
  );
  return strategy ? [strategy] : [];
}

function istDayFromStamp(value: string) {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return trimmed.slice(0, 10);
  return new Date(parsed).toLocaleDateString("en-CA", {
    timeZone: "Asia/Kolkata",
  });
}

function positionFromTrade(open: PaperTrade): OpenPosition {
  const storedLegs = open.legs?.filter(
    (leg) => leg.right === "CE" || leg.right === "PE",
  );
  const legs =
    storedLegs && storedLegs.length > 0
      ? storedLegs.map((leg) => ({
          right: leg.right,
          strike: leg.strike,
          strikeKey: leg.strikeKey ?? "ATM",
          qty: leg.qty,
          premium: leg.premium,
        }))
      : open.credit < 0 && open.short_strike === open.long_strike
        ? [
            {
              right: (open.long_side || open.short_side) as "CE" | "PE",
              strike: open.long_strike || open.short_strike,
              strikeKey: "ATM" as const,
              qty: 1,
              premium: Math.abs(open.credit),
            },
          ]
        : [
            {
              right: open.short_side as "CE" | "PE",
              strike: open.short_strike,
              strikeKey: "ATM" as const,
              qty: -1,
              premium: Math.abs(open.credit),
            },
            {
              right: open.long_side as "CE" | "PE",
              strike: open.long_strike,
              strikeKey: "ATM" as const,
              qty: 1,
              premium: 0,
            },
          ];

  return {
    strategyId: open.strategy_id,
    legs,
    netCredit: open.credit,
    width: open.width,
    entryAt: open.entry_at,
    expiryAt: open.expiry_at,
  };
}

export async function syncPaper(run?: PaperRun): Promise<{
  run: PaperRun;
  opened: PaperTrade | null;
  closed: PaperTrade | null;
  message: string;
}> {
  const active = run ?? getActiveRun();
  if (!active) {
    throw new Error("No active paper run. Start one first.");
  }

  const instrument = getIndexByParam(active.instrument_id);
  const strategies = resolveStrategies(active.strategy_id);
  if (!instrument || strategies.length === 0) {
    throw new Error("Invalid instrument or strategy on paper run");
  }

  const today = todayIst();
  const hour = hourIst();
  const minute = minuteIst();
  const closedTrades: PaperTrade[] = [];
  const openedTrades: PaperTrade[] = [];
  const skippedWallet: Array<{
    strategyId: string;
    marginInr: number;
    freeInr: number;
  }> = [];

  const chainCache = new Map<
    string,
    Awaited<ReturnType<typeof loadOptionChainPage>>
  >();
  const chainFor = async (expiry: string | null) => {
    const key = expiry ?? "";
    const hit = chainCache.get(key);
    if (hit) return hit;
    const page = await loadOptionChainPage(instrument, expiry);
    chainCache.set(key, page);
    if (page.expiry) chainCache.set(page.expiry, page);
    return page;
  };

  for (const open of listOpenTrades(active.id)) {
    const tradeChain = await chainFor(open.expiry_at);
    const settleStrategy = getStrategy(open.strategy_id) ?? strategies[0];
    const position = positionFromTrade(open);

    const exitPremiums = exitPremiumsFromChain(tradeChain.rows, position.legs, tradeChain.spot);
    const exitLegs = position.legs.map((leg) => ({
      ...leg,
      premium:
        exitPremiums[`${leg.strikeKey}:${leg.right}`] ??
        exitPremiums[`${leg.strike}:${leg.right}`] ??
        leg.premium,
    }));
    const pnlPoints = settleStrategy.settle(position, tradeChain.spot, exitPremiums);
    const decision = decidePaperExit({
      strategyId: open.strategy_id,
      hour,
      minute,
      today,
      expiryAt: open.expiry_at,
      credit: open.credit,
      pnlPoints,
      entryHour: open.entry_hour,
      expirySession: open.expiry_session,
      spot: tradeChain.spot,
      reclaimSpot: open.reclaim_spot,
      reclaimDir: open.reclaim_dir,
    });

    if (decision) {
      closeTrade(open.id, {
        spotExit: tradeChain.spot,
        pnlPoints: Math.round(decision.pnlPoints),
        pnlInr: Math.round(decision.pnlPoints * lotSizeFor(instrument.id)),
        exitLegs,
      });
      const closedTrade = listTradesForRun(active.id).find((t) => t.id === open.id);
      if (closedTrade) closedTrades.push(closedTrade);
    } else {
      patchTradeMark(open.id, {
        pnlPoints: Math.round(pnlPoints),
        pnlInr: Math.round(pnlPoints * lotSizeFor(instrument.id)),
        spot: tradeChain.spot,
      });
    }
  }

  const stillOpen = listOpenTrades(active.id);
  const openStrategyIds = new Set(stillOpen.map((trade) => trade.strategy_id));
  const morningOpen = inMorningEntryWindow(hour);
  const sweepWindow = inSweepEntryWindow(hour, minute);
  const wantProjectOne = morningOpen && !openStrategyIds.has(PROJECT_ONE_ID);
  const wantSweep = sweepWindow && !openStrategyIds.has(SWEEP_FADE_ID);

  if (!isIstTradingWeekday(today)) {
    return {
      run: active,
      opened: null,
      closed: closedTrades.at(-1) ?? null,
      message: closedTrades.length
        ? "Closed paper trade. Weekend — no new entry."
        : "Weekend — sitting out.",
    };
  }

  if (!morningOpen && !sweepWindow) {
    return {
      run: active,
      opened: null,
      closed: closedTrades.at(-1) ?? null,
      message: closedTrades.length
        ? `Closed paper trade. Outside ${MORNING_PLAYBOOK_WINDOW} IST.`
        : `Outside ${MORNING_PLAYBOOK_WINDOW} IST. Expiry credits only.`,
    };
  }

  if (wantProjectOne || wantSweep) {
    const entryChain = await chainFor(null);

    let quote:
      | { open: number; high: number; low: number; prevClose: number; price: number }
      | undefined;
    try {
      const quotes = await fetchIndexQuotes();
      quote = quotes.find((q) => q.id === instrument.id);
    } catch {
      quote = undefined;
    }

    let prior: { high: number; low: number; close: number } | null = null;
    try {
      prior = await fetchPriorSessionStats(instrument);
    } catch {
      prior = null;
    }

    const subset = chainAroundAtm(entryChain.rows, entryChain.spot, 10);
    const maxPain = computeMaxPain(subset);
    const walls = oiWalls(subset);
    const structure = buildLiveDayStructure({
      day: today,
      spot: entryChain.spot,
      instrumentId: instrument.id,
      maxPain,
      putOiSupport: walls.putSupport,
      callOiResistance: walls.callResist,
      quote,
      prior,
    });

    let tape: Awaited<ReturnType<typeof loadTodaySweepBars>> = [];
    try {
      tape = await loadTodaySweepBars(instrument);
    } catch {
      tape = [];
    }
    const sweep = detectLiquiditySweep({
      bars: tape,
      priorHigh: structure.priorHigh,
      priorLow: structure.priorLow,
      putOi: structure.putOiSupport,
      callOi: structure.callOiResistance,
      buffer: sweepBuffer(instrument.id),
      pick: "latest",
    });
    const freshSweep = sweep && sweepIsFresh(sweep, hour, minute) ? sweep : null;

    const ctx = {
      instrument,
      spot: entryChain.spot,
      widthSteps: active.width_steps || DEFAULT_WIDTH_STEPS,
      hour,
      minute,
      structure,
      rows: subset,
      expirySession: liveExpirySession(instrument.id, entryChain.expiry),
      sweep: freshSweep,
    };

    for (const picked of pickPlaybookEntries(ctx)) {
      if (picked.strategy.id === PROJECT_ONE_ID && !wantProjectOne) continue;
      if (picked.strategy.id === SWEEP_FADE_ID && !wantSweep) continue;
      if (openStrategyIds.has(picked.strategy.id)) continue;
      const extras =
        picked.strategy.id === SWEEP_FADE_ID
          ? sweepPositionExtras(ctx.sweep)
          : {};
      const marginInr = marginConsumedInr({
        instrument_id: instrument.id,
        strategy_id: picked.strategy.id,
        credit: picked.proposal.netCredit,
        width: picked.proposal.width,
        spot_entry: entryChain.spot,
        legs: picked.proposal.legs,
      });
      const wallet = getPaperWallet();
      if (!canAffordMargin(wallet.freeInr, marginInr)) {
        skippedWallet.push({
          strategyId: picked.strategy.id,
          marginInr,
          freeInr: wallet.freeInr,
        });
        continue;
      }
      openedTrades.push(
        insertOpenTrade({
          run_id: active.id,
          strategy_id: picked.strategy.id,
          short_strike: picked.proposal.primaryShortStrike,
          long_strike: picked.proposal.primaryLongStrike,
          short_side: picked.proposal.primaryShortSide,
          long_side: picked.proposal.primaryLongSide,
          credit: picked.proposal.netCredit,
          width: picked.proposal.width,
          spot_entry: entryChain.spot,
          entry_at: new Date().toISOString(),
          expiry_at: nextExpiryDateIst(instrument.id, today),
          expiry_session: ctx.expirySession,
          entry_hour: hour,
          reclaim_spot: extras.reclaimSpot ?? null,
          reclaim_dir: extras.reclaimDir ?? null,
          legs: picked.proposal.legs.map((leg) => ({
            right: leg.right,
            strike: leg.strike,
            strikeKey: leg.strikeKey,
            qty: leg.qty,
            premium: leg.premium,
          })),
        }),
      );
      openStrategyIds.add(picked.strategy.id);
    }
  }

  const opened = openedTrades.at(-1) ?? null;
  const closed = closedTrades.at(-1) ?? null;
  const clock = `${hour}:${String(minute).padStart(2, "0")}`;
  const openedLabel = openedTrades.map((trade) => trade.strategy_id).join(" and ");
  const walletSkip = skippedWallet[0];
  const walletSkipMessage = walletSkip
    ? `Wallet short of margin for ${walletSkip.strategyId} (need ₹${Math.round(walletSkip.marginInr).toLocaleString("en-IN")}, free ₹${Math.round(walletSkip.freeInr).toLocaleString("en-IN")}).`
    : null;
  const message =
    closedTrades.length > 0 && openedTrades.length > 0
      ? `Closed paper trade and opened ${openedLabel}.`
      : closedTrades.length > 1
        ? `Closed ${closedTrades.length} paper trades.`
        : closedTrades.length === 1
          ? "Closed paper trade."
          : openedTrades.length > 0
            ? `Opened ${openedLabel} (${clock} IST).`
            : walletSkipMessage
              ? walletSkipMessage
              : stillOpen.length > 1
                ? "Open paper trades are still active."
                : stillOpen.length === 1
                  ? "Open paper trade is still active."
                  : "No expiry credit for current structure — sitting out.";

  return { run: active, opened, closed, message };
}
