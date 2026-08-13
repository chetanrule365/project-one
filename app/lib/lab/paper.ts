import { getIndexByParam } from "../dhan/instruments";
import { loadOptionChainPage } from "../dhan/option-chain";
import { fetchIndexQuotes } from "../dhan/quotes";
import {
  getStrategy,
  listStrategies,
  pickExpiryPath,
  positionDefaults,
} from "../strategies/registry";
import {
  buildDayStructure,
  chainAroundAtm,
  computeMaxPain,
  expiryWeekday,
  istWeekday,
  oiWalls,
} from "../strategies/expiry-day";
import {
  DEFAULT_WIDTH_STEPS,
  FLAT_BY_HOUR,
  lotSizeFor,
  type OpenPosition,
  type Strategy,
} from "../strategies/types";
import {
  closeTrade,
  getActiveRun,
  getOpenTrade,
  insertOpenTrade,
  listActiveRuns,
  listPaperRuns,
  listAllTradesWithInstrument,
  listTradesForRun,
  startPaperRun,
  stopPaperRun,
  type PaperRun,
  type PaperTrade,
} from "./paper-store";

function todayIst() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function hourIst() {
  return Number(
    new Date().toLocaleTimeString("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      hour12: false,
    }).slice(0, 2),
  );
}

function isExpiryToday(instrumentId: string) {
  return istWeekday(todayIst()) === expiryWeekday(instrumentId);
}

export function getPaperSnapshot() {
  const activeRuns = listActiveRuns();
  const runs = listPaperRuns();
  const trades = listAllTradesWithInstrument();
  return {
    activeRuns,
    /** First active run — legacy single-run UI helpers. */
    active: activeRuns[0],
    runs,
    trades,
  };
}

export function startPaper(input: {
  instrumentId: string;
  strategyId: string;
  widthSteps: number;
}) {
  const run = startPaperRun(input);
  // Background sync while Node server stays up (browser can close).
  void import("./paper-worker").then((m) => m.ensurePaperWorker());
  return run;
}

export function stopPaper(runId: number) {
  stopPaperRun(runId);
}

function resolveStrategies(strategyId: string): Strategy[] {
  if (strategyId === "AUTO" || strategyId === "BOTH") {
    return listStrategies();
  }
  const strategy = getStrategy(strategyId);
  return strategy ? [strategy] : [];
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

  const chain = await loadOptionChainPage(instrument);
  const today = todayIst();
  const hour = hourIst();
  const open = getOpenTrade(active.id);
  let closed: PaperTrade | null = null;
  let opened: PaperTrade | null = null;

  if (open) {
    const settleStrategy = getStrategy(open.strategy_id) ?? strategies[0];
    const defaults = positionDefaults(open.strategy_id);
    // Reconstruct minimal position from stored 2-leg summary
    const position: OpenPosition = {
      strategyId: open.strategy_id,
      legs: [
        {
          right: open.short_side as "CE" | "PE",
          strike: open.short_strike,
          strikeKey: "ATM",
          qty: open.credit >= 0 ? -1 : 1,
          premium: Math.abs(open.credit),
        },
        {
          right: open.long_side as "CE" | "PE",
          strike: open.long_strike,
          strikeKey: "ATM",
          qty: open.credit >= 0 ? 1 : -1,
          premium: 0,
        },
      ],
      netCredit: open.credit,
      width: open.width,
      entryAt: open.entry_at,
      expiryAt: open.expiry_at,
      ...defaults,
    };

    const pnlPoints = settleStrategy.settle(position, chain.spot);
    const isDebit = open.credit < 0;
    const risk = Math.abs(open.credit) || 1;
    const stopLevel = isDebit
      ? -risk * (defaults.stopMult ?? 0.35)
      : -risk * (defaults.stopMult ?? 2);
    const hitStop = pnlPoints <= stopLevel;
    const flatBy =
      defaults.flatByHour !== undefined && hour >= defaults.flatByHour;
    const expired = today > open.expiry_at || (today === open.expiry_at && hour >= FLAT_BY_HOUR);

    if (hitStop || flatBy || expired) {
      const exitPnl = hitStop ? stopLevel : pnlPoints;
      closeTrade(open.id, {
        spotExit: chain.spot,
        pnlPoints: exitPnl,
        pnlInr: exitPnl * lotSizeFor(instrument.id),
      });
      closed = listTradesForRun(active.id).find((t) => t.id === open.id) ?? null;
    }
  }

  const stillOpen = getOpenTrade(active.id);
  if (!stillOpen) {
    if (!isExpiryToday(instrument.id)) {
      return {
        run: active,
        opened: null,
        closed,
        message: closed
          ? "Closed paper trade. Not expiry day — no new entry."
          : "Not Nifty/index expiry day (Tuesday for Nifty) — sitting out.",
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

    const subset = chainAroundAtm(chain.rows, chain.spot, 10);
    const maxPain = computeMaxPain(subset);
    const walls = oiWalls(subset);
    const openPx = quote?.open ?? chain.spot;
    const structure = buildDayStructure({
      day: today,
      spot: chain.spot,
      open: openPx,
      priorHigh: quote?.high ?? chain.spot * 1.005,
      priorLow: quote?.low ?? chain.spot * 0.995,
      priorClose: quote?.prevClose ?? chain.spot,
      morningBars: [],
      maxPain,
      putOiSupport: walls.putSupport,
      callOiResistance: walls.callResist,
    });
    // Live: treat day as quiet if day's range so far is calm
    if (quote) {
      const rangePct =
        quote.prevClose > 0
          ? ((quote.high - quote.low) / quote.prevClose) * 100
          : 99;
      structure.quietDay = rangePct <= 1.2;
      structure.orbBrokenUp = chain.spot > quote.open * 1.003;
      structure.orbBrokenDown = chain.spot < quote.open * 0.997;
      // Mutual exclusivity for clean ORB
      if (structure.orbBrokenUp && structure.orbBrokenDown) {
        structure.orbBrokenUp = false;
        structure.orbBrokenDown = false;
      }
    }

    const ctx = {
      instrument,
      spot: chain.spot,
      widthSteps: active.width_steps || DEFAULT_WIDTH_STEPS,
      hour,
      structure,
      rows: subset,
    };

    const picked =
      active.strategy_id === "AUTO" || active.strategy_id === "BOTH"
        ? pickExpiryPath(ctx)
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
        spot_entry: chain.spot,
        entry_at: today,
        expiry_at: today,
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
