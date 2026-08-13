import { Form, useNavigation } from "react-router";
import type { Route } from "./+types/strategies";
import { AppNav } from "../components/AppNav";
import { StrategyCards } from "../components/StrategyCards";
import {
  INDEX_INSTRUMENTS,
  getIndexByParam,
} from "../lib/dhan/instruments";
import { loadOptionChainPage } from "../lib/dhan/option-chain";
import {
  DhanApiError,
  DhanConfigError,
  fetchIndexQuotes,
} from "../lib/dhan/quotes";
import { buildCreditSpreads, type CreditSpread } from "../lib/dhan/strategies";
import {
  getPaperSnapshot,
  startPaper,
  stopPaper,
} from "../lib/lab/paper";
import { formatPaperLegs } from "../lib/lab/paper-position";
import {
  ensurePaperWorker,
  getPaperWorkerStatus,
} from "../lib/lab/paper-worker";
import { listStrategies } from "../lib/strategies/registry";
import { DEFAULT_WIDTH_STEPS } from "../lib/strategies/types";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Strategies" },
    {
      name: "description",
      content: "Expiry-day playbook and multi-index paper trading",
    },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  ensurePaperWorker();
  const paper = getPaperSnapshot();
  const url = new URL(request.url);
  const instrumentId = String(url.searchParams.get("instrument") ?? "NIFTY");
  const instrument =
    getIndexByParam(instrumentId) ?? INDEX_INSTRUMENTS[0];
  const widthParam = Number(url.searchParams.get("width") ?? DEFAULT_WIDTH_STEPS);
  const widthSteps = Number.isFinite(widthParam)
    ? Math.max(1, Math.min(5, Math.floor(widthParam)))
    : DEFAULT_WIDTH_STEPS;
  const requestedExpiry = url.searchParams.get("expiry");

  let spreads: CreditSpread[] = [];
  let expiry = "";
  let playbookError: string | null = null;
  let spot: number | null = null;

  try {
    const chain = await loadOptionChainPage(instrument, requestedExpiry);
    let quote:
      | { open: number; high: number; low: number; prevClose: number }
      | undefined;
    try {
      const quotes = await fetchIndexQuotes();
      const match = quotes.find((q) => q.id === instrument.id);
      if (match) {
        quote = {
          open: match.open,
          high: match.high,
          low: match.low,
          prevClose: match.prevClose,
        };
      }
    } catch {
      quote = undefined;
    }
    spreads = buildCreditSpreads(
      chain.rows,
      chain.spot,
      widthSteps,
      quote,
      instrument,
    );
    expiry = chain.expiry;
    spot = chain.spot;
  } catch (error) {
    playbookError =
      error instanceof DhanConfigError || error instanceof DhanApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Failed to load playbook";
  }

  return {
    instruments: INDEX_INSTRUMENTS,
    strategies: listStrategies().map((s) => ({ id: s.id, name: s.name })),
    paper,
    worker: getPaperWorkerStatus(),
    playbook: {
      instrument,
      spreads,
      widthSteps,
      expiry,
      spot,
      error: playbookError,
    },
  };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  try {
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
        paperMessage: `Paper run started for ${instrumentId}.`,
      };
    }

    if (intent === "paper-stop") {
      const runId = Number(form.get("runId"));
      if (runId) stopPaper(runId);
      return {
        ok: true as const,
        error: null,
        paperMessage: "Paper run stopped.",
      };
    }

    return {
      ok: false as const,
      error: "Unknown action",
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
      paperMessage: null,
    };
  }
}

function formatNumber(value: number, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export default function StrategiesPage({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const paper = loaderData.paper;
  const { playbook } = loaderData;

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100 px-4 py-8 dark:from-gray-950 dark:via-gray-950 dark:to-gray-900">
      <div className="mx-auto max-w-6xl">
        <AppNav />

        <header className="mb-6">
          <p className="text-sm font-medium tracking-wide text-slate-500 uppercase">
            Playbook
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
            Strategies
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            Live expiry-day playbook and multi-index paper trading. No real
            orders.
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

        <section className="mb-8 rounded-xl border border-slate-200 bg-white/90 p-4 dark:border-slate-800 dark:bg-slate-900/70">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Expiry-day playbook
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {playbook.instrument.name}
                {playbook.spot != null
                  ? ` · ${formatNumber(playbook.spot)}`
                  : ""}
                {playbook.expiry ? ` · ${playbook.expiry}` : ""}
                <span className="text-slate-400"> · </span>
                Go = eligible · Sit = skip
              </p>
            </div>
            <form method="get" className="flex flex-wrap items-center gap-2">
              {playbook.expiry ? (
                <input type="hidden" name="expiry" value={playbook.expiry} />
              ) : null}
              <label className="flex items-center gap-1.5 text-xs">
                <span className="text-slate-500">Index</span>
                <select
                  name="instrument"
                  defaultValue={playbook.instrument.id}
                  onChange={(event) => event.currentTarget.form?.requestSubmit()}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-950"
                >
                  {loaderData.instruments.map((instrument) => (
                    <option key={instrument.id} value={instrument.id}>
                      {instrument.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-xs">
                <span className="text-slate-500">Width</span>
                <select
                  name="width"
                  defaultValue={String(playbook.widthSteps)}
                  onChange={(event) => event.currentTarget.form?.requestSubmit()}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-950"
                >
                  {[1, 2, 3, 4].map((step) => (
                    <option key={step} value={step}>
                      {step}
                    </option>
                  ))}
                </select>
              </label>
            </form>
          </div>

          {playbook.error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
              {playbook.error}
            </div>
          ) : playbook.spreads.length > 0 && playbook.expiry ? (
            <StrategyCards
              spreads={playbook.spreads}
              widthSteps={playbook.widthSteps}
              action="/strategies"
              expiry={playbook.expiry}
              hideHeader
            />
          ) : (
            <p className="text-sm text-slate-500">Loading playbook…</p>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white/90 p-5 dark:border-slate-800 dark:bg-slate-900/70">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                Paper trading
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                One active run per index. Worker syncs while the{" "}
                <strong>Node server</strong> is up (browser can close).
              </p>
            </div>
            {paper.trades.length > 0 ? (
              <a
                href="/api/paper-trades.xlsx"
                download
                className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900"
              >
                Download Excel
              </a>
            ) : null}
          </div>

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
              disabled={busy}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900"
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
                        {formatPaperLegs(trade)}
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
