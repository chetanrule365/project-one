import type { Route } from "./+types/paper";
import { PaperTradesList } from "../components/PaperTradesList";
import { WalletStrip } from "../components/WalletStrip";
import {
  currentMonthIst,
  entryMonthIst,
  formatMonthLabel,
  getPaperSnapshot,
} from "../lib/lab/paper";
import {
  ensurePaperWorker,
} from "../lib/lab/paper-worker";
import { pullPaperStore } from "../lib/lab/paper-store";
import { bootSession } from "../lib/session.server";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Paper trades" },
    {
      name: "description",
      content: "Always-on paper trading history",
    },
  ];
}

function monthFromSearch(value: string | null, fallback: string) {
  if (value === "all") return "all";
  if (value && /^\d{4}-\d{2}$/.test(value)) return value;
  return fallback;
}

export async function loader({ request }: Route.LoaderArgs) {
  await bootSession(request);
  await pullPaperStore();
  ensurePaperWorker();
  const paper = getPaperSnapshot();
  const closedTrades = paper.trades.filter((trade) => trade.status === "closed");
  const currentMonth = currentMonthIst();
  const months = [
    ...new Set(
      [currentMonth, ...closedTrades.map((trade) => entryMonthIst(trade.entry_at))],
    ),
  ].sort((a, b) => b.localeCompare(a));
  const month = monthFromSearch(
    new URL(request.url).searchParams.get("month"),
    currentMonth,
  );
  const trades =
    month === "all"
      ? closedTrades
      : closedTrades.filter((trade) => entryMonthIst(trade.entry_at) === month);

  return {
    paper: {
      ...paper,
      trades,
    },
    months,
    month,
    monthPnl: trades.reduce((sum, trade) => sum + (trade.pnl_inr ?? 0), 0),
    monthLabel: month === "all" ? "All-time" : formatMonthLabel(month),
  };
}

function formatPnl(value: number) {
  const formatted = value.toLocaleString("en-IN", {
    maximumFractionDigits: 0,
  });
  if (value > 0) return `+₹ ${formatted}`;
  if (value < 0) return `−₹ ${formatted.replace("-", "")}`;
  return `₹ ${formatted}`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function monthFilterHtml(month: string, months: string[]) {
  const options = [
    `<option value="all"${month === "all" ? " selected" : ""}>All months</option>`,
    ...months.map(
      (value) =>
        `<option value="${escapeHtml(value)}"${month === value ? " selected" : ""}>${escapeHtml(formatMonthLabel(value))}</option>`,
    ),
  ].join("");
  return `<form method="get" action="/paper"><label class="block"><span class="mb-1 block text-[11px] font-medium tracking-wide text-slate-500 uppercase">Month</span><select id="paper-month" name="month" onchange="this.form.submit()" class="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950">${options}</select></label></form>`;
}

export default function PaperPage({ loaderData }: Route.ComponentProps) {
  const { paper, months, month, monthPnl, monthLabel } = loaderData;
  const pnlTone =
    monthPnl > 0
      ? "text-emerald-600 dark:text-emerald-400"
      : monthPnl < 0
        ? "text-rose-600 dark:text-rose-400"
        : "text-slate-700 dark:text-slate-200";

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100 px-3 py-4 sm:px-4 sm:py-8 dark:from-gray-950 dark:via-gray-950 dark:to-gray-900">
      <div className="mx-auto max-w-6xl">
        <header className="mb-4 sm:mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl dark:text-white">
            Paper trades
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-snug text-slate-500 dark:text-slate-400">
            Closed trade history against a ₹1 lakh wallet. Live open positions
            are on the Market Watch home page. Simulation only — no real orders.
          </p>
        </header>

        {paper.wallet ? (
          <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 dark:border-slate-800 dark:bg-slate-900/70">
            <WalletStrip wallet={paper.wallet} />
          </section>
        ) : null}

        <section className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 dark:border-slate-800 dark:bg-slate-900/70">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                {monthLabel} P&L
              </p>
              <p className={`mt-1 text-2xl font-semibold tabular-nums ${pnlTone}`}>
                {formatPnl(monthPnl)}
              </p>
            </div>
            <div
              className="sm:w-56"
              dangerouslySetInnerHTML={{
                __html: monthFilterHtml(month, months),
              }}
            />
          </div>

          <PaperTradesList trades={paper.trades} />
        </section>
      </div>
    </main>
  );
}
