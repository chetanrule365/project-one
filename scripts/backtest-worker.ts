import { readFileSync } from "node:fs";
import { getIndexByParam, INDEX_INSTRUMENTS } from "../app/lib/dhan/instruments";
import { runBacktest } from "../app/lib/lab/backtest";
import {
  claimBacktestWorker,
  completeBacktestJob,
  failBacktestJob,
  reportBacktestProgress,
} from "../app/lib/lab/backtest-job";
import { saveBacktest } from "../app/lib/lab/backtest-store";

try {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    if (process.env[key]) continue;
    process.env[key] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {
  /* spawn already copies process.env */
}

type Payload = {
  instrumentId: string;
  strategyIds: string[];
  widthSteps: number;
  months: number;
};

function readPayload(): Payload {
  const raw = process.env.BACKTEST_JOB?.trim();
  if (!raw) throw new Error("Missing BACKTEST_JOB payload");
  return JSON.parse(raw) as Payload;
}

const payload = readPayload();
const instrument =
  getIndexByParam(payload.instrumentId) ?? INDEX_INSTRUMENTS[0];

claimBacktestWorker();
process.on("uncaughtException", (error) => {
  failBacktestJob(error instanceof Error ? error.message : "Worker crashed");
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  failBacktestJob(
    reason instanceof Error ? reason.message : "Worker rejected",
  );
  process.exit(1);
});

try {
  const result = await runBacktest({
    instrument,
    strategyIds: payload.strategyIds,
    widthSteps: payload.widthSteps,
    months: payload.months,
    onProgress: reportBacktestProgress,
  });
  const saved = saveBacktest(result);
  completeBacktestJob({ id: saved.id, trades: saved.metrics.trades });
} catch (error) {
  failBacktestJob(error instanceof Error ? error.message : "Backtest failed");
  process.exitCode = 1;
}
