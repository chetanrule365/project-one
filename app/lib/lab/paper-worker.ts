import { getOpenTrade, listActiveRuns, type PaperRun } from "./paper-store";
import { repairStoredPaperPnls, syncPaper } from "./paper";
import { FLAT_BY_HOUR } from "../strategies/types";
import { isIstTradingWeekday, todayIst } from "../strategies/expiry-day";

/** Active market-window poll (IST). */
const ACTIVE_SYNC_MS = 60_000;
/** Idle poll when no open trade / off-window. */
const IDLE_SYNC_MS = 5 * 60_000;

type WorkerState = {
  started: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  lastSyncAt: string | null;
  lastMessage: string | null;
  lastError: string | null;
  running: boolean;
};

const globalForWorker = globalThis as typeof globalThis & {
  __paperWorker?: WorkerState;
};

function state(): WorkerState {
  if (!globalForWorker.__paperWorker) {
    globalForWorker.__paperWorker = {
      started: false,
      timer: null,
      lastSyncAt: null,
      lastMessage: null,
      lastError: null,
      running: false,
    };
  }
  return globalForWorker.__paperWorker;
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

function shouldSyncNow(active: PaperRun) {
  const open = getOpenTrade(active.id);
  if (open) return true;

  const hour = hourIst();
  if (!isIstTradingWeekday(todayIst())) return false;
  if (hour >= 9 && hour < FLAT_BY_HOUR) return true;
  return false;
}

function safeActiveRuns(): PaperRun[] {
  try {
    return listActiveRuns();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[paper-worker] store read failed: ${message}`);
    return [];
  }
}

function nextDelayMs(runs: PaperRun[]) {
  if (runs.length === 0) return IDLE_SYNC_MS;
  return runs.some(shouldSyncNow) ? ACTIVE_SYNC_MS : IDLE_SYNC_MS;
}

async function tick() {
  const s = state();
  if (s.running) return;
  s.running = true;
  try {
    repairStoredPaperPnls();
    const runs = safeActiveRuns();
    if (runs.length === 0) {
      s.lastMessage = "No active paper runs";
      return;
    }
    const due = runs.filter(shouldSyncNow);
    if (due.length === 0) {
      s.lastMessage = `Idle — ${runs.length} run(s) waiting for market window or open trade`;
      return;
    }

    const messages: string[] = [];
    for (const run of due) {
      try {
        const result = await syncPaper(run);
        messages.push(`${run.instrument_id}: ${result.message}`);
        console.log(`[paper-worker] ${run.instrument_id}: ${result.message}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        messages.push(`${run.instrument_id}: ${message}`);
        console.error(`[paper-worker] ${run.instrument_id}: ${message}`);
      }
    }
    s.lastSyncAt = new Date().toISOString();
    s.lastMessage = messages.join(" · ");
    s.lastError = null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    s.lastError = message;
    s.lastMessage = null;
    console.error(`[paper-worker] ${message}`);
  } finally {
    s.running = false;
  }
}

function schedule() {
  const s = state();
  if (s.timer) clearTimeout(s.timer);
  const delay = nextDelayMs(safeActiveRuns());
  s.timer = setTimeout(() => {
    void tick()
      .catch((error) => {
        console.error("[paper-worker] tick failed", error);
      })
      .finally(() => schedule());
  }, delay);
}

/** Start background paper sync (idempotent). Survives browser close while Node is up. */
export function ensurePaperWorker() {
  const s = state();
  if (s.started) return;
  s.started = true;
  console.log(
    "[paper-worker] started — syncs all active index runs while Node stays up",
  );
  setTimeout(() => {
    void tick()
      .catch((error) => {
        console.error("[paper-worker] tick failed", error);
      })
      .finally(() => schedule());
  }, 2_000);
}

export function getPaperWorkerStatus() {
  const s = state();
  const runs = safeActiveRuns();
  return {
    started: s.started,
    hasActiveRun: runs.length > 0,
    activeCount: runs.length,
    lastSyncAt: s.lastSyncAt,
    lastMessage: s.lastMessage,
    lastError: s.lastError,
    nextMode: runs.some(shouldSyncNow) ? "active" : "idle",
  };
}

if (process.env.NODE_ENV === "production") {
  ensurePaperWorker();
}
