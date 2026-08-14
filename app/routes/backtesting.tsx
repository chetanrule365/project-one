import { Form, useNavigation } from "react-router";
import type { Route } from "./+types/backtesting";
import { AppNav } from "../components/AppNav";
import { INDEX_INSTRUMENTS, getIndexByParam } from "../lib/dhan/instruments";
import { DhanApiError, DhanConfigError } from "../lib/dhan/quotes";
import { runBacktest, type BacktestResult } from "../lib/lab/backtest";
import { listStrategies } from "../lib/strategies/registry";
import { DEFAULT_WIDTH_STEPS } from "../lib/strategies/types";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Backtesting" },
    {
      name: "description",
      content: "Weekday playbook historical backtests",
    },
  ];
}

export async function loader() {
  return {
    instruments: INDEX_INSTRUMENTS,
    strategies: listStrategies().map((s) => ({ id: s.id, name: s.name })),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();

  try {
    const instrumentId = String(form.get("instrumentId") ?? "NIFTY");
    const strategyMode = String(form.get("strategyId") ?? "AUTO");
    const widthSteps = Number(form.get("widthSteps") ?? DEFAULT_WIDTH_STEPS);
    const months = Number(form.get("months") ?? 6);
    const instrument = getIndexByParam(instrumentId);
    if (!instrument) {
      return { ok: false as const, error: "Unknown index", backtest: null };
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

    return { ok: true as const, error: null, backtest };
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

function BacktestResults({ result }: { result: BacktestResult }) {
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

export default function BacktestingPage({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const backtest = actionData?.backtest ?? null;

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100 px-4 py-8 dark:from-gray-950 dark:via-gray-950 dark:to-gray-900">
      <div className="mx-auto max-w-6xl">
        <AppNav />

        <header className="mb-6">
          <p className="text-sm font-medium tracking-wide text-slate-500 uppercase">
            Simulation
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
            Backtesting
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            Historical weekday playbook. Expiry auto path: Iron Condor → OI fade
            → Max Pain → ORB. Other days: ORB debit spread → OI fade → Iron
            Condor (max pain sits out). Hourly bars, not a true 15m opening
            range. No real orders.
          </p>
        </header>

        {actionData?.error ? (
          <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
            {actionData.error}
          </div>
        ) : null}

        <section className="rounded-2xl border border-slate-200 bg-white/90 p-5 dark:border-slate-800 dark:bg-slate-900/70">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Run backtest
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Premium sells flatten by ~14:00; stops at 2× credit or 35% debit.
          </p>

          <Form
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
                defaultValue="AUTO"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="AUTO">Auto (one path / session)</option>
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
      </div>
    </main>
  );
}
