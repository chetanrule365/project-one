import { getIndexByParam } from "../dhan/instruments";
import { loadOptionChainPage } from "../dhan/option-chain.server";
import { fetchIndexQuotes, fetchPriorSessionStats } from "../dhan/quotes.server";
import {
  getStrategy,
  pickPlaybookEntries,
} from "../strategies/registry";
import { isProjectOne, PROJECT_ONE_ID } from "../strategies/project-one";
import { intrinsic } from "../strategies/common";
import {
  EXPIRY_TREND_ID,
  inExpiryTrendWindow,
} from "../strategies/expiry-trend-credit";
import {
  buildLiveDayStructure,
  chainAroundAtm,
  computeMaxPain,
  isIstTradingWeekday,
  liveExpirySession,
  nextExpiryDateIst,
  normalizeExpiryDay,
  oiWalls,
  todayIst,
} from "../strategies/expiry-day";
import {
  DEFAULT_WIDTH_STEPS,
  istClock,
  lotSizeFor,
  type OpenPosition,
  type Strategy,
} from "../strategies/types";
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
} from "./paper-store.server";
import {
  exitPremiumsFromChain,
} from "./paper-position";
import {
  marginConsumedInr,
  paperTradeBrokerageInr,
  paperTradeNetPnlInr,
} from "./paper-shared";
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

export {
  currentMonthIst,
  entryMonthIst,
  formatMonthLabel,
  marginConsumedInr,
  paperTradeBrokerageInr,
  paperTradeNetPnlInr,
} from "./paper-shared";

export function getPaperSnapshot() {
  // repairStoredPaperPnls() removed — ensure stored pnls are valid elsewhere
  const activeRuns = listActiveRuns();
  const runs = listAllPaperRuns();
  const runById = new Map(runs.map((run) => [run.id, run]));
  const activeIds = new Set(activeRuns.map((run) => run.id));
  const trades = listAllPaperTrades()
    .map((trade) => {
      const instrumentId = runById.get(trade.run_id)?.instrument_id;
      const brokerage_inr = paperTradeBrokerageInr(trade);
      return {
        ...trade,
        instrument_id: instrumentId,
        margin_inr: marginConsumedInr({
          ...trade,
          instrument_id: instrumentId,
        }),
        brokerage_inr,
        pnl_after_brokerage_inr: paperTradeNetPnlInr({
          ...trade,
          brokerage_inr,
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

/** Always-on paper: Expiry Trend Credit on Nifty. No start/stop required. */
export function ensureAlwaysOnPaperRuns() {
  const active = listActiveRuns();
  if (!active.some((run) => run.instrument_id === "NIFTY")) {
    startPaperRun({
      instrumentId: "NIFTY",
      strategyId: EXPIRY_TREND_ID,
      widthSteps: DEFAULT_WIDTH_STEPS,
    });
  }
}

export function startPaper(input: {
  instrumentId: string;
  strategyId: string;
  widthSteps: number;
}) {
  const run = startPaperRun(input);
  void import("./paper-worker.server").then((m) => m.ensurePaperWorker());
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

    // Dhan falls back to the next expiry once ours is gone; settle at intrinsic instead.
    const chainIsOurs =
      !tradeChain.expiry || tradeChain.expiry === normalizeExpiryDay(open.expiry_at);
    const exitPremiums = chainIsOurs
      ? exitPremiumsFromChain(tradeChain.rows, position.legs, tradeChain.spot)
      : {};
    const exitLegs = position.legs.map((leg) => ({
      ...leg,
      premium:
        exitPremiums[`${leg.strikeKey}:${leg.right}`] ??
        exitPremiums[`${leg.strike}:${leg.right}`] ??
        (chainIsOurs ? leg.premium : intrinsic(leg.right, leg.strike, tradeChain.spot)),
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
        brokerageInr: paperTradeBrokerageInr(open),
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
  const expiryTrendWindow = inExpiryTrendWindow(hour, minute);
  const expiryTrendDoneToday = listTradesForRun(active.id).some(
    (trade) =>
      trade.strategy_id === EXPIRY_TREND_ID &&
      new Date(trade.entry_at).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) ===
        today,
  );
  const wantExpiryTrend =
    expiryTrendWindow && !expiryTrendDoneToday && instrument.id === "NIFTY";

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

  if (!expiryTrendWindow) {
    return {
      run: active,
      opened: null,
      closed: closedTrades.at(-1) ?? null,
      message: closedTrades.length
        ? "Closed paper trade. Entries only 12:30–12:45 IST on Nifty expiry."
        : "Entries only 12:30–12:45 IST on Nifty expiry.",
    };
  }

  if (wantExpiryTrend) {
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

    const ctx = {
      instrument,
      spot: entryChain.spot,
      widthSteps: active.width_steps || DEFAULT_WIDTH_STEPS,
      hour,
      minute,
      structure,
      rows: subset,
      expirySession: liveExpirySession(instrument.id, entryChain.expiry),
    };

    for (const picked of pickPlaybookEntries(ctx)) {
      if (openStrategyIds.has(picked.strategy.id)) continue;
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
          expiry_at: entryChain.expiry ?? nextExpiryDateIst(instrument.id, today),
          expiry_session: ctx.expirySession,
          entry_hour: hour,
          reclaim_spot: null,
          reclaim_dir: null,
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
