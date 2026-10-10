import { useEffect, useRef, useState } from "react";
import { Link, useFetcher, useRevalidator } from "react-router";
import type { Route } from "./+types/backtesting";
import { INDEX_INSTRUMENTS, getIndexByParam } from "../lib/dhan/instruments";
import { DhanApiError, DhanConfigError } from "../lib/dhan/quotes";
import {
  DHAN_FNO_BROKERAGE_PER_ORDER,
  strategyNetRows,
  tradeBrokerageInr,
  tradePnlAfterBrokerageInr,
} from "../lib/lab/backtest";
import {
  lastBacktestJob,
  subscribeBacktestJob,
} from "../lib/lab/backtest-job-feed";
import { peekBacktestJob, startBacktestJob } from "../lib/lab/backtest-job";
import {
  getBacktest,
  listBacktests,
  type SavedBacktest,
} from "../lib/lab/backtest-store";
import {
  autoPlaybookStrategyIds,
  listStrategies,
} from "../lib/strategies/registry";
import { DEFAULT_WIDTH_STEPS } from "../lib/strategies/types";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Backtesting" },
    {
      name: "description",
      content: "Playbook historical backtests",
    },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const runId = Number(new URL(request.url).searchParams.get("run") ?? "");
  const job = peekBacktestJob();
  const savedId =
    Number.isFinite(runId) && runId > 0 ? runId : job.resultId;
  const saved = savedId ? getBacktest(savedId) : null;
  return {
    instruments: INDEX_INSTRUMENTS,
    strategies: listStrategies().map((s) => ({ id: s.id, name: s.name })),
    history: listBacktests(),
    saved,
    job,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();

  try {
    const instrumentId = String(form.get("instrumentId") ?? "NIFTY");
    const strategyMode = String(form.get("strategyId") ?? "PROJECT_ONE");
    const widthSteps = Number(form.get("widthSteps") ?? DEFAULT_WIDTH_STEPS);
    const months = Number(form.get("months") ?? 6);
    const instrument = getIndexByParam(instrumentId);
    if (!instrument) {
      return { ok: false as const, error: "Unknown index", backtest: null };
    }

    const strategyIds =
      strategyMode === "AUTO" || strategyMode === "BOTH"
        ? autoPlaybookStrategyIds()
        : [strategyMode];

    const started = startBacktestJob({
      instrument,
      strategyIds,
      widthSteps,
      months,
    });
    if (!started.ok) {
      return { ok: false as const, error: started.error ?? "Busy", backtest: null };
    }

    return { ok: true as const, error: null, backtest: null };
  } catch (error) {
    const message =
      error instanceof DhanConfigError || error instanceof DhanApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Backtest failed";
    return { ok: false as const, error: message, backtest: null };
  }
}

function formatNumber(value: number, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  if (value === Infinity) return "∞";
  return value.toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white/90 p-4 dark:border-slate-800 dark:bg-slate-900/70">
      <p className="text-xs tracking-wide text-slate-500 uppercase">{label}</p>
      <p className="mt-2 text-xl font-semibold tabular-nums text-slate-900 dark:text-white">
        {value}
      </p>
    </div>
  );
}

function BacktestResults({ result }: { result: SavedBacktest }) {
  const m = result.metrics;
  return (
    <section className="mt-8 space-y-4">
      <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
        Results
      </h2>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {result.instrumentId} · {result.from} → {result.to} · lot{" "}
        {result.lotSize} · wing width {result.widthSteps} ·{" "}
        {result.mode === "auto" ? "Auto path" : "Single path"}
        {` · saved ${new Date(result.savedAt).toLocaleString("en-IN")}`}
        {` · Dhan ₹${DHAN_FNO_BROKERAGE_PER_ORDER}/order (buy+sell each leg; GST/STT not included)`}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Trades" value={String(m.trades)} />
        <MetricCard label="Win rate" value={`${formatNumber(m.winRate, 1)}%`} />
        <MetricCard
          label="Gross P&L (₹)"
          value={formatNumber(m.totalPnlInr, 0)}
        />
        <MetricCard
          label="Brokerage (₹)"
          value={formatNumber(m.brokerageInr ?? 0, 0)}
        />
        <MetricCard
          label="P&L after brokerage (₹)"
          value={formatNumber(m.totalPnlAfterBrokerageInr ?? m.totalPnlInr, 0)}
        />
        <MetricCard
          label="Max drawdown (₹)"
          value={formatNumber(-Math.abs(m.maxDrawdownInr), 0)}
        />
        <MetricCard
          label="Avg P&L (pts)"
          value={formatNumber(m.avgPnlPoints)}
        />
        <MetricCard
          label="Profit factor"
          value={formatNumber(m.profitFactor, 2)}
        />
        <MetricCard label="Wins" value={String(m.wins)} />
        <MetricCard label="Losses" value={String(m.losses)} />
      </div>

      {(() => {
        const rows = m.byStrategy?.length
          ? m.byStrategy
          : strategyNetRows(result.trades);
        if (rows.length === 0) return null;
        return (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs tracking-wide text-slate-500 uppercase dark:bg-slate-900 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left">Strategy</th>
                  <th className="px-3 py-2 text-right">Trades</th>
                  <th className="px-3 py-2 text-right">Win %</th>
                  <th className="px-3 py-2 text-right">Avg pts</th>
                  <th className="px-3 py-2 text-right">Gross ₹</th>
                  <th className="px-3 py-2 text-right">Brk ₹</th>
                  <th className="px-3 py-2 text-right">Net ₹</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.strategyId}
                    className="border-t border-slate-100 dark:border-slate-800"
                  >
                    <td className="px-3 py-2">{row.strategyName}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.trades}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatNumber(row.winRate, 1)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatNumber(row.avgPnlPoints)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatNumber(row.totalPnlInr, 0)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatNumber(row.brokerageInr, 0)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">
                      {formatNumber(row.totalPnlAfterBrokerageInr, 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs tracking-wide text-slate-500 uppercase dark:bg-slate-900 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">Path</th>
              <th className="px-3 py-2 text-left">Why</th>
              <th className="px-3 py-2 text-left">Day</th>
              <th className="px-3 py-2 text-left">Expiry day</th>
              <th className="px-3 py-2 text-left">Hours</th>
              <th className="px-3 py-2 text-left">Exit</th>
              <th className="px-3 py-2 text-right">Credit</th>
              <th className="px-3 py-2 text-right">P&L pts</th>
              <th className="px-3 py-2 text-right">Gross ₹</th>
              <th className="px-3 py-2 text-right">Brk ₹</th>
              <th className="px-3 py-2 text-right">Net ₹</th>
              <th className="px-3 py-2 text-right">Result</th>
            </tr>
          </thead>
          <tbody>
            {result.trades.map((trade, index) => (
              <tr
                key={`${trade.strategyId}-${trade.entryDay}-${index}`}
                className="border-t border-slate-100 dark:border-slate-800"
              >
                <td className="px-3 py-2">{trade.strategyName}</td>
                <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                  {trade.pickReason ?? "—"}
                </td>
                <td className="px-3 py-2 tabular-nums">{trade.entryDay}</td>
                <td className="px-3 py-2">{trade.expirySession ? "Yes" : "No"}</td>
                <td className="px-3 py-2 tabular-nums">
                  {trade.entryHour}:00→{trade.exitHour}:00
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  {trade.exitReason ?? "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatNumber(trade.credit)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatNumber(trade.pnlPoints)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatNumber(trade.pnlInr, 0)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                  {formatNumber(tradeBrokerageInr(trade), 0)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatNumber(tradePnlAfterBrokerageInr(trade), 0)}
                </td>
                <td
                  className={`px-3 py-2 text-right font-medium ${
                    tradePnlAfterBrokerageInr(trade) > 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400"
                  }`}
                >
                  {tradePnlAfterBrokerageInr(trade) > 0 ? "Win" : "Loss"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function BacktestingPage({
  loaderData,
}: Route.ComponentProps) {
  const run = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const [job, setJob] = useState(lastBacktestJob() ?? loaderData.job);
  const seenResult = useRef<string | null>(null);
  useEffect(() => subscribeBacktestJob(setJob), []);
  const resultKey = `${job.status}:${job.resultId ?? ""}:${job.finishedAt ?? ""}`;
  useEffect(() => {
    if (job.status !== "done" && job.status !== "error") return;
    if (seenResult.current === resultKey) return;
    seenResult.current = resultKey;
    revalidator.revalidate();
  }, [resultKey, job.status, revalidator]);
  const submitting = run.state !== "idle";
  const running = job.status === "running" || submitting;
  const backtest = loaderData.saved ?? null;
  const history = loaderData.history;
  const error =
    (run.data && run.data.ok === false ? run.data.error : null) ??
    (job.status === "error" ? job.error : null);

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100 px-4 py-8 dark:from-gray-950 dark:via-gray-950 dark:to-gray-900">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6">
          <p className="text-sm font-medium tracking-wide text-slate-500 uppercase">
            Simulation
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
            Backtesting
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            Project One only — follow a real break, sell premium only when it
            pays 4× brokerage, otherwise sit. Saved in data/backtests.json. No
            real orders.
          </p>
        </header>

        {error ? (
          <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
            {error}
          </div>
        ) : null}

        <section className="rounded-2xl border border-slate-200 bg-white/90 p-5 dark:border-slate-800 dark:bg-slate-900/70">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Run backtest
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            First 12-month run pulls Dhan hourly bars at 1 request / 3s
            (~10–15 min). This page updates live — no refresh. Cached reruns
            are fast.
          </p>

          {running ? (
            <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
              <p className="font-medium">Running — not hung</p>
              <p className="mt-1 text-sky-800 dark:text-sky-200">
                {submitting ? "Starting…" : job.message || "Fetching history…"}
              </p>
              {job.total > 0 ? (
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-sky-200 dark:bg-sky-900">
                  <div
                    className="h-full bg-sky-600 dark:bg-sky-400"
                    style={{
                      width: `${Math.min(100, (job.done / job.total) * 100)}%`,
                    }}
                  />
                </div>
              ) : null}
              <p className="mt-1 text-xs tabular-nums text-sky-700 dark:text-sky-300">
                {job.done}/{job.total || "…"}
                {job.cached || job.fetched
                  ? ` · ${job.cached} cache / ${job.fetched} live`
                  : ""}
              </p>
            </div>
          ) : null}

          <run.Form
            method="post"
            className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
          >
            <label className="text-sm">
              <span className="text-slate-500">Index</span>
              <select
                name="instrumentId"
                defaultValue="NIFTY"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
              >
                {loaderData.instruments.map((instrument) => (
                  <option key={instrument.id} value={instrument.id}>
                    {instrument.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="text-slate-500">Strategy</span>
              <select
                name="strategyId"
                defaultValue="PROJECT_ONE"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
              >
                {loaderData.strategies.map((strategy) => (
                  <option key={strategy.id} value={strategy.id}>
                    {strategy.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="text-slate-500">Wing width</span>
              <select
                name="widthSteps"
                defaultValue={String(DEFAULT_WIDTH_STEPS)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
              >
                {[1, 2, 3, 4].map((step) => (
                  <option key={step} value={step}>
                    {step} (~{step * 50} pts)
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="text-slate-500">Lookback</span>
              <select
                name="months"
                defaultValue="6"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
              >
                {[3, 6, 9, 12].map((months) => (
                  <option key={months} value={months}>
                    {months} months
                  </option>
                ))}
              </select>
            </label>
            <div className="relative z-10 flex items-end">
              <button
                type="submit"
                className="w-full cursor-pointer rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
              >
                {submitting
                  ? "Starting…"
                  : job.status === "running"
                    ? "Run again"
                    : "Run backtest"}
              </button>
            </div>
          </run.Form>
        </section>

        {history.length > 0 ? (
          <section className="mt-8">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Saved runs
            </h2>
            <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-xs tracking-wide text-slate-500 uppercase dark:bg-slate-900 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-left">When</th>
                    <th className="px-3 py-2 text-left">Index</th>
                    <th className="px-3 py-2 text-left">Strategy</th>
                    <th className="px-3 py-2 text-left">Window</th>
                    <th className="px-3 py-2 text-right">Trades</th>
                    <th className="px-3 py-2 text-right">Win %</th>
                    <th className="px-3 py-2 text-right">Gross ₹</th>
                    <th className="px-3 py-2 text-right">Net ₹</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((run) => (
                    <tr
                      key={run.id}
                      className="border-t border-slate-100 dark:border-slate-800"
                    >
                      <td className="px-3 py-2">
                        <Link
                          to={`/backtesting?run=${run.id}`}
                          className="font-medium text-sky-700 underline-offset-2 hover:underline dark:text-sky-300"
                        >
                          {new Date(run.savedAt).toLocaleString("en-IN")}
                        </Link>
                      </td>
                      <td className="px-3 py-2">{run.instrumentId}</td>
                      <td className="px-3 py-2 text-xs">
                        {run.strategyIds.join(", ")}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-xs">
                        {run.from} → {run.to}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {run.trades}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatNumber(run.winRate, 1)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatNumber(run.totalPnlInr, 0)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatNumber(run.totalPnlAfterBrokerageInr, 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {backtest ? <BacktestResults result={backtest} /> : null}
      </div>
    </main>
  );
}
