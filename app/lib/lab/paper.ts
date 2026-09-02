import { getIndexByParam, INDEX_INSTRUMENTS } from "../dhan/instruments";
import { loadOptionChainPage } from "../dhan/option-chain";
import { fetchIndexQuotes, fetchPriorSessionStats } from "../dhan/quotes";
import {
  getStrategy,
  listStrategies,
  pickPlaybookPath,
  positionDefaults,
} from "../strategies/registry";
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
  FLAT_BY_HOUR,
  IC_SPAN_NOTIONAL_FRAC,
  lotSizeFor,
  type Strategy,
  type OpenPosition,
} from "../strategies/types";
import {
  closeTrade,
  getActiveRun,
  getOpenTrade,
  insertOpenTrade,
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


function hourIst() {
  return Number(
    new Date().toLocaleTimeString("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      hour12: false,
    }).slice(0, 2),
  );
}


/**
 * Capital blocked in ₹ for 1 lot.
 * Buys: premium paid.
 * Iron condor: Dhan-style SPAN (~4.4% of notional, ~₹70k on Nifty).
 * Other credit spreads: defined-risk max loss (width − credit).
 */
export function marginConsumedInr(trade: {
  instrument_id?: string;
  strategy_id: string;
  credit: number;
  width: number;
  spot_entry?: number;
}) {
  const lot = lotSizeFor(trade.instrument_id ?? "NIFTY");
  // Use the same margin calculation for all strategies: span-based margin when
  // `spot_entry` is available (uniform notional fraction), else fall back to
  // sensible defaults based on net credit/width.
  if (trade.spot_entry) {
    return trade.spot_entry * lot * IC_SPAN_NOTIONAL_FRAC;
  }
  const debit = trade.credit < 0 || trade.strategy_id === "ORB_ATM" || trade.strategy_id === "MAX_PAIN_REV";
  if (debit) return Math.abs(trade.credit) * lot;
  return Math.max(0, trade.width - trade.credit) * lot;
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
  };
}

/**
 * Open paper trades with their latest live (unrealized) mark-to-market P&L.
 * Marks are refreshed by the paper worker each sync tick.
 */
export function getLivePaperTrades() {
  const trades = getPaperSnapshot().trades.filter(
    (trade) => trade.status === "open",
  );
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
  return { trades, totalPnlInr, asOf };
}

/** Always-on paper: one AUTO run per index. No start/stop required. */
export function ensureAlwaysOnPaperRuns() {
  const active = listActiveRuns();
  for (const instrument of INDEX_INSTRUMENTS) {
    if (!active.some((run) => run.instrument_id === instrument.id)) {
      startPaperRun({
        instrumentId: instrument.id,
        strategyId: "AUTO",
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
  if (strategyId === "AUTO" || strategyId === "BOTH") {
    return listStrategies();
  }
  const strategy = getStrategy(strategyId);
  return strategy ? [strategy] : [];
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
  const open = getOpenTrade(active.id);
  let closed: PaperTrade | null = null;
  let opened: PaperTrade | null = null;

  // Load the chain for the open trade's actual expiry so marks use the right strikes/prices.
  // For the entry decision we always want the near-expiry chain; cache it separately.
  const tradeChain = await loadOptionChainPage(instrument, open?.expiry_at ?? null);
  // Near-expiry chain for entry decisions (may be the same object as tradeChain).
  const entryChain =
    !open || tradeChain.expiry === tradeChain.expiries[0]
      ? tradeChain
      : await loadOptionChainPage(instrument, null);

  if (open) {
    const settleStrategy = getStrategy(open.strategy_id) ?? strategies[0];
    const defaults = positionDefaults(open.strategy_id);
    const position: OpenPosition = {
      ...positionFromTrade(open),
      ...defaults,
    };

    const exitPremiums = exitPremiumsFromChain(tradeChain.rows, position.legs, tradeChain.spot);
    const exitLegs = position.legs.map((leg) => ({
      ...leg,
      premium:
        exitPremiums[`${leg.strikeKey}:${leg.right}`] ??
        exitPremiums[`${leg.strike}:${leg.right}`] ??
        leg.premium,
    }));
    const pnlPoints = settleStrategy.settle(position, tradeChain.spot, exitPremiums);
    const isDebit = open.credit < 0;
    const risk = Math.abs(open.credit) || 1;
    const stopLevel = isDebit
      ? -risk * (defaults.stopMult ?? 0.35)
      : -risk * (defaults.stopMult ?? 2);
    const hitStop = pnlPoints <= stopLevel;
    const flatBy = defaults.flatByHour !== undefined && hour >= defaults.flatByHour;
    const expired = today > open.expiry_at || (today === open.expiry_at && hour >= FLAT_BY_HOUR);

    if (hitStop || flatBy || expired) {
      const exitPnl = hitStop ? stopLevel : pnlPoints;
      closeTrade(open.id, {
        spotExit: tradeChain.spot,
        pnlPoints: Math.round(exitPnl),
        pnlInr: Math.round(exitPnl * lotSizeFor(instrument.id)),
        exitLegs,
      });
      closed = listTradesForRun(active.id).find((t) => t.id === open.id) ?? null;
    } else {
      // Still open — persist the current mark-to-market so the home page can
      // show a live, unrealized P&L without re-fetching the chain itself.
      patchTradeMark(open.id, {
        pnlPoints: Math.round(pnlPoints),
        pnlInr: Math.round(pnlPoints * lotSizeFor(instrument.id)),
        spot: tradeChain.spot,
      });
    }
  }

  const stillOpen = getOpenTrade(active.id);
  if (!stillOpen) {
    if (!isIstTradingWeekday(today)) {
      return {
        run: active,
        opened: null,
        closed,
        message: closed
          ? "Closed paper trade. Weekend — no new entry."
          : "Weekend — sitting out.",
      };
    }
    if (hour < 10 || hour >= FLAT_BY_HOUR) {
      return {
        run: active,
        opened: null,
        closed,
        message: closed
          ? "Closed paper trade. Outside 10:00–14:00 entry window."
          : "Outside 10:00–14:00 IST entry window.",
      };
    }

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
      structure,
      rows: subset,
      expirySession: liveExpirySession(instrument.id, entryChain.expiry),
    };

    const picked =
      active.strategy_id === "AUTO" || active.strategy_id === "BOTH"
        ? pickPlaybookPath(ctx)
        : (() => {
            const strategy = strategies[0];
            if (!strategy?.isEligible(ctx)) return null;
            const proposal = strategy.proposeEntry(ctx);
            return proposal
              ? { strategy, proposal, reason: "Single strategy" }
              : null;
          })();

    if (picked) {
      opened = insertOpenTrade({
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
        legs: picked.proposal.legs.map((leg) => ({
          right: leg.right,
          strike: leg.strike,
          strikeKey: leg.strikeKey,
          qty: leg.qty,
          premium: leg.premium,
        })),
      });
    }
  }

  const message =
    closed && opened
      ? `Closed trade and opened ${opened.strategy_id}.`
      : closed
        ? "Closed paper trade."
        : opened
          ? `Opened ${opened.strategy_id} (${hour}:00 window).`
          : stillOpen
            ? "Open paper trade is still active."
            : "No playbook signal for current structure — sitting out.";

  return { run: active, opened, closed, message };
}
