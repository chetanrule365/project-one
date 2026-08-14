import { getIndexByParam } from "../dhan/instruments";
import { loadOptionChainPage } from "../dhan/option-chain";
import { fetchIndexQuotes, fetchPriorSessionStats } from "../dhan/quotes";
import {
  getStrategy,
  listStrategies,
  pickPlaybookPath,
} from "../strategies/registry";
import {
  buildLiveDayStructure,
  chainAroundAtm,
  computeMaxPain,
  isIstTradingWeekday,
  liveExpirySession,
  normalizeExpiryDay,
  oiWalls,
  todayIst,
} from "../strategies/expiry-day";
import {
  DEFAULT_WIDTH_STEPS,
  FLAT_BY_HOUR,
  lotSizeFor,
  type Strategy,
} from "../strategies/types";
import { decidePaperExit } from "./paper-exit";
import {
  closeTrade,
  getActiveRun,
  getOpenTrade,
  insertOpenTrade,
  listActiveRuns,
  listPaperRuns,
  listAllTradesWithInstrument,
  listTradesForRun,
  patchTradePnl,
  startPaperRun,
  stopPaperRun,
  type PaperRun,
  type PaperTrade,
} from "./paper-store";
import {
  pnlLooksBroken,
  settleTradePoints,
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

export function getPaperSnapshot() {
  repairStoredPaperPnls();
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

export function repairStoredPaperPnls() {
  const lotByInstrument = new Map<string, number>();
  for (const trade of listAllTradesWithInstrument()) {
    if (trade.status !== "closed") continue;
    if (trade.spot_exit == null || trade.pnl_points == null) continue;
    const corrected = settleTradePoints(trade, trade.spot_exit);
    if (
      !pnlLooksBroken(trade.pnl_points, trade.credit, trade.spot_exit, corrected)
    ) {
      continue;
    }
    const lot =
      lotByInstrument.get(trade.instrument_id) ??
      lotSizeFor(trade.instrument_id);
    lotByInstrument.set(trade.instrument_id, lot);
    patchTradePnl(trade.id, {
      pnlPoints: corrected,
      pnlInr: corrected * lot,
    });
  }
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
    const pnlPoints = settleTradePoints(open, chain.spot, chain.rows);
    const decision = decidePaperExit({
      strategyId: open.strategy_id,
      hour,
      today,
      expiryAt: open.expiry_at,
      credit: open.credit,
      pnlPoints,
      entryHour: open.entry_hour,
      expirySession: open.expiry_session,
    });
    if (decision) {
      closeTrade(open.id, {
        spotExit: chain.spot,
        pnlPoints: decision.pnlPoints,
        pnlInr: decision.pnlPoints * lotSizeFor(instrument.id),
      });
      closed = listTradesForRun(active.id).find((t) => t.id === open.id) ?? null;
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

    const subset = chainAroundAtm(chain.rows, chain.spot, 10);
    const maxPain = computeMaxPain(subset);
    const walls = oiWalls(subset);
    const structure = buildLiveDayStructure({
      day: today,
      spot: chain.spot,
      instrumentId: instrument.id,
      maxPain,
      putOiSupport: walls.putSupport,
      callOiResistance: walls.callResist,
      quote,
      prior,
    });

    const ctx = {
      instrument,
      spot: chain.spot,
      widthSteps: active.width_steps || DEFAULT_WIDTH_STEPS,
      hour,
      structure,
      rows: subset,
      expirySession: liveExpirySession(instrument.id, chain.expiry),
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
        spot_entry: chain.spot,
        entry_at: today,
        expiry_at: normalizeExpiryDay(chain.expiry) || today,
        expiry_session: ctx.expirySession,
        legs: picked.proposal.legs,
        entry_hour: hour,
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
