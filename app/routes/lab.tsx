import { Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/lab";
import { INDEX_INSTRUMENTS, getIndexByParam } from "../lib/dhan/instruments";
import { DhanApiError, DhanConfigError } from "../lib/dhan/quotes";
import { runBacktest, type BacktestResult } from "../lib/lab/backtest";
import {
  getPaperSnapshot,
  startPaper,
  stopPaper,
} from "../lib/lab/paper";
import {
  ensurePaperWorker,
  getPaperWorkerStatus,
} from "../lib/lab/paper-worker";
import { listStrategies } from "../lib/strategies/registry";
import { DEFAULT_WIDTH_STEPS } from "../lib/strategies/types";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Strategy Lab" },
    {
      name: "description",
      content: "Nifty expiry-day playbook backtest and paper trading",
    },
  ];
}

export async function loader() {
  ensurePaperWorker();
  const paper = getPaperSnapshot();
  return {
    instruments: INDEX_INSTRUMENTS,
    strategies: listStrategies().map((s) => ({ id: s.id, name: s.name })),
    paper,
    worker: getPaperWorkerStatus(),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  try {
    if (intent === "backtest") {
      const instrumentId = String(form.get("instrumentId") ?? "NIFTY");
      const strategyMode = String(form.get("strategyId") ?? "AUTO");
      const widthSteps = Number(form.get("widthSteps") ?? DEFAULT_WIDTH_STEPS);
      const months = Number(form.get("months") ?? 6);
      const instrument = getIndexByParam(instrumentId);
      if (!instrument) {
        return {
          ok: false as const,
          error: "Unknown index",
          backtest: null,
          paperMessage: null,
        };
      }

      const strategyIds =
        strategyMode === "AUTO" || strategyMode === "BOTH"
          ? listStrategies().map((s) => s.id)
          : [strategyMode];

      const backtest = await runBacktest({
        instrument,
        strategyIds,
        widthSteps,
        months,
      });

      return {
        ok: true as const,
        error: null,
        backtest,
        paperMessage: null,
      };
    }

    if (intent === "paper-start") {
      const instrumentId = String(form.get("instrumentId") ?? "NIFTY");
      const strategyId = String(form.get("strategyId") ?? "AUTO");
      const widthSteps = Number(form.get("widthSteps") ?? DEFAULT_WIDTH_STEPS);
      startPaper({
        instrumentId,
        strategyId:
          strategyId === "BOTH" || strategyId === "AUTO" ? "AUTO" : strategyId,
        widthSteps,
      });
      return {
        ok: true as const,
        error: null,
        backtest: null,
        paperMessage: `Paper run started for ${instrumentId}.`,
      };
    }

    if (intent === "paper-stop") {
      const runId = Number(form.get("runId"));
      if (runId) stopPaper(runId);
      return {
        ok: true as const,
        error: null,
        backtest: null,
        paperMessage: "Paper run stopped.",
      };
    }

    return {
      ok: false as const,
      error: "Unknown action",
      backtest: null,
      paperMessage: null,
    };
  } catch (error) {
    const message =
      error instanceof DhanConfigError || error instanceof DhanApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Action failed";
    return {
      ok: false as const,
      error: message,
      backtest: null,
      paperMessage: null,
    };
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

function BacktestResults({ result }: { result: BacktestResult }) {
  const m = result.metrics;
  return (
    <section className="mt-8 space-y-4">
      <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
        Backtest results
      </h2>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {result.instrumentId} · {result.from} → {result.to} · lot{" "}
        {result.lotSize} · wing width {result.widthSteps} ·{" "}
        {result.mode === "auto" ? "Auto path" : "Single path"}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Trades" value={String(m.trades)} />
        <MetricCard label="Win rate" value={`${formatNumber(m.winRate, 1)}%`} />
        <MetricCard
          label="Total P&L (₹)"
          value={formatNumber(m.totalPnlInr, 0)}
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

      <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs tracking-wide text-slate-500 uppercase dark:bg-slate-900 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">Path</th>
              <th className="px-3 py-2 text-left">Why</th>
              <th className="px-3 py-2 text-left">Day</th>
              <th className="px-3 py-2 text-left">Hours</th>
              <th className="px-3 py-2 text-left">Exit</th>
              <th className="px-3 py-2 text-right">Credit</th>
              <th className="px-3 py-2 text-right">P&L pts</th>
              <th className="px-3 py-2 text-right">P&L ₹</th>
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
                <td
                  className={`px-3 py-2 text-right font-medium ${
                    trade.won
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400"
                  }`}
                >
                  {trade.won ? "Win" : "Loss"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function LabPage({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const paper = loaderData.paper;
  const backtest = actionData?.backtest ?? null;

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100 px-4 py-8 dark:from-gray-950 dark:via-gray-950 dark:to-gray-900">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between gap-3">
          <Link
            to="/"
            className="text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
          >
            ← Market Watch
          </Link>
        </div>

        <header className="mb-6">
          <p className="text-sm font-medium tracking-wide text-slate-500 uppercase">
            Simulation
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
            Strategy Lab
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            Nifty Tuesday expiry-day playbook. Historical backtests and paper
            trades only — no real orders. ORB uses hourly bars (not true 15m
            opening range).
          </p>
        </header>

        {actionData?.error ? (
          <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
            {actionData.error}
          </div>
        ) : null}

        {actionData?.paperMessage ? (
          <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
            {actionData.paperMessage}
          </div>
        ) : null}

        <section className="rounded-2xl border border-slate-200 bg-white/90 p-5 dark:border-slate-800 dark:bg-slate-900/70">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Backtest
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            One path per expiry Tuesday: ORB → Iron Condor → Max Pain → OI fade
            (or sit out). Premium sells flatten by ~14:00; stops at 2× credit or
            35% debit.
          </p>

          <Form
            method="post"
            className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
          >
            <input type="hidden" name="intent" value="backtest" />
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
                defaultValue="AUTO"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="AUTO">Auto (one path / Tuesday)</option>
                {loaderData.strategies.map((strategy) => (
                  <option key={strategy.id} value={strategy.id}>
                    {strategy.name} only
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
            <div className="flex items-end">
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900"
              >
                {busy ? "Running…" : "Run backtest"}
              </button>
            </div>
          </Form>
        </section>

        {backtest ? <BacktestResults result={backtest} /> : null}

        <section className="mt-10 rounded-2xl border border-slate-200 bg-white/90 p-5 dark:border-slate-800 dark:bg-slate-900/70">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Paper trading
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Run Nifty, Bank Nifty, and Sensex together — one active paper run
            per index. Background worker syncs while the{" "}
            <strong>Node server</strong> is up (browser can close). Entries on
            each index&apos;s expiry day 10:00–14:00 IST. No real orders.
          </p>

          {loaderData.worker?.started ? (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Worker: {loaderData.worker.nextMode}
              {loaderData.worker.activeCount
                ? ` · ${loaderData.worker.activeCount} active`
                : ""}
              {loaderData.worker.lastSyncAt
                ? ` · last sync ${new Date(loaderData.worker.lastSyncAt).toLocaleTimeString("en-IN")}`
                : ""}
              {loaderData.worker.lastMessage
                ? ` · ${loaderData.worker.lastMessage}`
                : ""}
              {loaderData.worker.lastError
                ? ` · error: ${loaderData.worker.lastError}`
                : ""}
            </p>
          ) : null}

          <Form method="post" className="mt-4 flex flex-wrap items-end gap-3">
            <input type="hidden" name="intent" value="paper-start" />
            <label className="text-sm">
              <span className="text-slate-500">Index</span>
              <select
                name="instrumentId"
                defaultValue="NIFTY"
                className="mt-1 block rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
              >
                {loaderData.instruments.map((instrument) => {
                  const running = paper.activeRuns.some(
                    (run) => run.instrument_id === instrument.id,
                  );
                  return (
                    <option key={instrument.id} value={instrument.id}>
                      {instrument.name}
                      {running ? " (restart)" : ""}
                    </option>
                  );
                })}
              </select>
            </label>
            <label className="text-sm">
              <span className="text-slate-500">Strategy</span>
              <select
                name="strategyId"
                defaultValue="AUTO"
                className="mt-1 block rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="AUTO">Auto playbook</option>
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
                className="mt-1 block rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
              >
                {[1, 2, 3].map((step) => (
                  <option key={step} value={step}>
                    {step}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"
            >
              Start paper run
            </button>
          </Form>

          {paper.activeRuns.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {paper.activeRuns.map((run) => (
                <li
                  key={run.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800"
                >
                  <span className="text-slate-700 dark:text-slate-200">
                    #{run.id} · {run.instrument_id} · {run.strategy_id} · width{" "}
                    {run.width_steps}
                  </span>
                  <Form method="post">
                    <input type="hidden" name="intent" value="paper-stop" />
                    <input type="hidden" name="runId" value={run.id} />
                    <button
                      type="submit"
                      className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-700 dark:border-rose-800 dark:text-rose-300"
                    >
                      Stop
                    </button>
                  </Form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-slate-500">No active paper runs.</p>
          )}

          {paper.trades.length > 0 ? (
            <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-xs tracking-wide text-slate-500 uppercase dark:bg-slate-900 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-left">Index</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Path</th>
                    <th className="px-3 py-2 text-left">Entry</th>
                    <th className="px-3 py-2 text-right">Legs</th>
                    <th className="px-3 py-2 text-right">Credit</th>
                    <th className="px-3 py-2 text-right">P&L ₹</th>
                  </tr>
                </thead>
                <tbody>
                  {paper.trades.map((trade) => (
                    <tr
                      key={trade.id}
                      className="border-t border-slate-100 dark:border-slate-800"
                    >
                      <td className="px-3 py-2">
                        {"instrument_id" in trade
                          ? String(trade.instrument_id)
                          : "—"}
                      </td>
                      <td className="px-3 py-2 capitalize">{trade.status}</td>
                      <td className="px-3 py-2">{trade.strategy_id}</td>
                      <td className="px-3 py-2 tabular-nums">{trade.entry_at}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {trade.short_strike}/{trade.long_strike}{" "}
                        {trade.short_side}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatNumber(trade.credit)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {trade.pnl_inr === null
                          ? "—"
                          : formatNumber(trade.pnl_inr, 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
