import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { getDataDir } from "../data-dir";
import type { IndexInstrument } from "../dhan/instruments";
import { countRollingChunks } from "../dhan/rolling-options";
import type { RollingProgress } from "../dhan/rolling-options";
import { strikeKey } from "../strategies/common";
import { atmBandKeys } from "../strategies/expiry-day";
import {
  autoPlaybookStrategyIds,
  getStrategy,
} from "../strategies/registry";
import { DEFAULT_WIDTH_STEPS } from "../strategies/types";

export type BacktestJob = {
  status: "idle" | "running" | "done" | "error";
  message: string;
  done: number;
  total: number;
  cached: number;
  fetched: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  resultId: number | null;
  pid: number | null;
};

const IDLE: BacktestJob = {
  status: "idle",
  message: "",
  done: 0,
  total: 0,
  cached: 0,
  fetched: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
  resultId: null,
  pid: null,
};

function jobPath() {
  mkdirSync(getDataDir(), { recursive: true });
  return path.join(getDataDir(), "backtest-job.json");
}

function isPidAlive(pid: number | null | undefined) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function stopPid(pid: number | null | undefined) {
  if (!pid || pid <= 0) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      process.kill(pid, "SIGTERM");
    }
  } catch {
    /* already gone */
  }
}

function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function jobMtimeMs() {
  try {
    return statSync(jobPath()).mtimeMs;
  } catch {
    return 0;
  }
}

function msSinceProgress(job: BacktestJob) {
  const mtime = jobMtimeMs();
  if (mtime > 0) return Date.now() - mtime;
  if (job.startedAt) {
    const started = Date.parse(job.startedAt);
    if (Number.isFinite(started)) return Date.now() - started;
  }
  return 0;
}

function reconcileJob(job: BacktestJob): BacktestJob {
  if (job.status !== "running") return job;
  const quietMs = msSinceProgress(job);
  const pidAlive = isPidAlive(job.pid);
  if (quietMs > 45_000 && !pidAlive) {
    return failJob(job, "Worker stopped — click Run backtest again");
  }
  if (quietMs > 4 * 60_000) {
    return failJob(job, "Timed out — click Run backtest again");
  }
  return job;
}

function readJobFile(): BacktestJob {
  const file = jobPath();
  if (!existsSync(file)) return { ...IDLE };
  try {
    return { ...IDLE, ...(JSON.parse(readFileSync(file, "utf8")) as BacktestJob) };
  } catch {
    return { ...IDLE };
  }
}

function writeJob(next: BacktestJob) {
  const file = jobPath();
  const payload = JSON.stringify(next, null, 2);
  let lastError: unknown;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      // Direct write — Windows rename() fails with EPERM if the loader has the file open.
      writeFileSync(file, payload);
      return;
    } catch (error) {
      lastError = error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY") throw error;
      sleepSync(30);
    }
  }
  throw lastError;
}

function failJob(job: BacktestJob, error: string): BacktestJob {
  const next: BacktestJob = {
    ...job,
    status: "error",
    error,
    message: "Failed",
    finishedAt: new Date().toISOString(),
  };
  writeJob(next);
  return next;
}

export function peekBacktestJob(): BacktestJob {
  return readJobFile();
}

export function getBacktestJob(): BacktestJob {
  return reconcileJob(readJobFile());
}

export function claimBacktestWorker() {
  const prev = readJobFile();
  if (prev.status !== "running") return;
  writeJob({
    ...prev,
    pid: process.pid,
    message: prev.message || "Worker started",
  });
}

function isThisWorker(job: BacktestJob) {
  if (job.status !== "running") return false;
  if (!job.pid) return true;
  return job.pid === process.pid;
}

export function reportBacktestProgress(progress: RollingProgress) {
  const prev = readJobFile();
  if (!isThisWorker(prev)) return;
  const remaining = Math.max(0, progress.total - progress.done);
  const etaMin =
    progress.fetched > 0
      ? Math.ceil((remaining * 3.2) / 60)
      : Math.ceil((remaining * 0.05) / 60);
  try {
    writeJob({
      ...prev,
      status: "running",
      done: progress.done,
      total: progress.total || prev.total,
      cached: progress.cached || prev.cached,
      fetched: progress.fetched || prev.fetched,
      message:
        progress.label ||
        (progress.fetched
          ? `Dhan ${progress.fetched} live / ${progress.cached} cache · ~${Math.max(etaMin, 1)} min left`
          : `Reading cache ${progress.done}/${progress.total || prev.total}`),
    });
  } catch {
    // Loader may have the file open on Windows; skip this tick.
  }
}

export function completeBacktestJob(saved: { id: number; trades: number }) {
  const prev = readJobFile();
  if (!isThisWorker(prev)) return;
  writeJob({
    ...prev,
    status: "done",
    message: `Saved ${saved.trades} trades`,
    finishedAt: new Date().toISOString(),
    resultId: saved.id,
    error: null,
  });
}

export function failBacktestJob(error: string) {
  const prev = readJobFile();
  if (!isThisWorker(prev)) return;
  failJob(prev, error);
}

function estimateChunks(
  strategyIds: string[],
  widthSteps: number,
  months: number,
) {
  const to = new Date();
  const from = new Date(to);
  from.setMonth(from.getMonth() - months);
  let strategies = strategyIds
    .map((id) => getStrategy(id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s));
  if (strategies.length === 0) {
    strategies = autoPlaybookStrategyIds()
      .map((id) => getStrategy(id))
      .filter((s): s is NonNullable<typeof s> => Boolean(s));
  }
  const strikeKeys = [
    ...new Set([
      ...atmBandKeys(4),
      ...strategies.flatMap((s) => s.requiredStrikeKeys(widthSteps)),
    ]),
  ];
  if (!strikeKeys.includes(strikeKey(0))) strikeKeys.unshift(strikeKey(0));
  return countRollingChunks(strikeKeys, ["CALL", "PUT"], from, to);
}

function spawnWorker(payload: {
  instrumentId: string;
  strategyIds: string[];
  widthSteps: number;
  months: number;
}) {
  const worker = path.join(process.cwd(), "scripts", "backtest-worker.ts");
  const tsxCli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  mkdirSync(getDataDir(), { recursive: true });
  const logFd = openSync(path.join(getDataDir(), "backtest-worker.log"), "a");
  const child = spawn(process.execPath, [tsxCli, worker], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BACKTEST_JOB: JSON.stringify(payload),
    },
    stdio: ["ignore", logFd, logFd],
    detached: true,
    windowsHide: true,
  });
  try {
    closeSync(logFd);
  } catch {
    /* child still holds the fd */
  }
  child.unref();
  return child;
}

function runInProcess(payload: {
  instrumentId: string;
  strategyIds: string[];
  widthSteps: number;
  months: number;
  instrument: IndexInstrument;
}) {
  const prev = readJobFile();
  writeJob({ ...prev, pid: process.pid, message: "Running in server…" });
  setTimeout(() => {
    void (async () => {
      try {
        const { runBacktest } = await import("./backtest");
        const { saveBacktest } = await import("./backtest-store");
        const result = await runBacktest({
          instrument: payload.instrument,
          strategyIds: payload.strategyIds,
          widthSteps: payload.widthSteps,
          months: payload.months,
          onProgress: reportBacktestProgress,
        });
        const saved = saveBacktest(result);
        completeBacktestJob({ id: saved.id, trades: saved.metrics.trades });
      } catch (error) {
        failBacktestJob(
          error instanceof Error ? error.message : "Backtest failed",
        );
      }
    })();
  }, 0);
}

export function startBacktestJob(input: {
  instrument: IndexInstrument;
  strategyIds: string[];
  widthSteps: number;
  months: number;
}): { ok: boolean; error?: string } {
  const current = getBacktestJob();
  if (current.status === "running") {
    const alive = isPidAlive(current.pid);
    const stuckAtStart = current.done <= 0;
    if (alive && !stuckAtStart) {
      return { ok: false, error: "A backtest is already running." };
    }
    stopPid(current.pid);
    failJob(current, "Replaced by a new run");
  }

  const widthSteps = Math.max(
    1,
    Math.min(4, input.widthSteps || DEFAULT_WIDTH_STEPS),
  );
  const months = Math.max(1, Math.min(12, input.months || 6));
  const total = estimateChunks(input.strategyIds, widthSteps, months);

  writeJob({
    ...IDLE,
    status: "running",
    message: "Starting worker…",
    total,
    startedAt: new Date().toISOString(),
  });

  const payload = {
    instrumentId: input.instrument.id,
    strategyIds: input.strategyIds,
    widthSteps,
    months,
  };

  try {
    const child = spawnWorker(payload);
    if (!child.pid) {
      runInProcess({ ...payload, instrument: input.instrument });
      return { ok: true };
    }
    const latest = readJobFile();
    if (latest.status === "running" && !latest.pid) {
      writeJob({ ...latest, pid: child.pid });
    }
  } catch (error) {
    runInProcess({ ...payload, instrument: input.instrument });
    if (error instanceof Error) {
      writeJob({
        ...readJobFile(),
        message: `Worker spawn failed, running in server — ${error.message}`,
      });
    }
  }

  return { ok: true };
}
