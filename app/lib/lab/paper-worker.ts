import { getActiveRun, getOpenTrade } from "./paper-store";
import { syncPaper } from "./paper";
import { FLAT_BY_HOUR } from "../strategies/types";
import { expiryWeekday, istWeekday } from "../strategies/expiry-day";

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

function shouldSyncNow(active: NonNullable<ReturnType<typeof getActiveRun>>) {
  const open = getOpenTrade(active.id);
  if (open) return true; // manage stops / flat-by while open

  const hour = hourIst();
  const expiryToday = istWeekday(todayIst()) === expiryWeekday(active.instrument_id);
  // Entry window with a little buffer before 10:00
  if (expiryToday && hour >= 9 && hour < FLAT_BY_HOUR) return true;
  return false;
}

function nextDelayMs(active: ReturnType<typeof getActiveRun>) {
  if (!active) return IDLE_SYNC_MS;
  return shouldSyncNow(active) ? ACTIVE_SYNC_MS : IDLE_SYNC_MS;
}

async function tick() {
  const s = state();
  if (s.running) return;
  s.running = true;
  try {
    const active = getActiveRun();
    if (!active) {
      s.lastMessage = "No active paper run";
      return;
    }
    if (!shouldSyncNow(active)) {
      s.lastMessage = "Idle — waiting for expiry window or open trade";
      return;
    }
    const result = await syncPaper(active);
    s.lastSyncAt = new Date().toISOString();
    s.lastMessage = result.message;
    s.lastError = null;
    console.log(`[paper-worker] ${result.message}`);
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
  const delay = nextDelayMs(getActiveRun());
  s.timer = setTimeout(async () => {
    await tick();
    schedule();
  }, delay);
}

/** Start background paper sync (idempotent). Survives browser close while Node is up. */
export function ensurePaperWorker() {
  const s = state();
  if (s.started) return;
  s.started = true;
  console.log(
    "[paper-worker] started — syncs while an active run exists (Node process must stay up)",
  );
  // Kick once soon, then schedule
  void tick().finally(() => schedule());
}

export function getPaperWorkerStatus() {
  const s = state();
  const active = getActiveRun();
  return {
    started: s.started,
    hasActiveRun: Boolean(active),
    lastSyncAt: s.lastSyncAt,
    lastMessage: s.lastMessage,
    lastError: s.lastError,
    nextMode: active && shouldSyncNow(active) ? "active" : "idle",
  };
}
