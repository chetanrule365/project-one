import type { Route } from "./+types/paper";
import { PaperTradesList } from "../components/PaperTradesList";
import {
  currentMonthIst,
  entryMonthIst,
  formatMonthLabel,
  getPaperSnapshot,
} from "../lib/lab/paper";
import {
  ensurePaperWorker,
} from "../lib/lab/paper-worker";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Paper trades" },
    {
      name: "description",
      content: "Always-on paper trading history",
    },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  ensurePaperWorker();
  const paper = getPaperSnapshot();
  const currentMonth = currentMonthIst();
  const requested = new URL(request.url).searchParams.get("month");
  const month =
    requested && /^\d{4}-\d{2}$/.test(requested) ? requested : currentMonth;
  const months = [
    ...new Set(
      [currentMonth, ...paper.trades.map((trade) => entryMonthIst(trade.entry_at))],
    ),
  ].sort((a, b) => b.localeCompare(a));
  const trades = paper.trades.filter(
    (trade) => entryMonthIst(trade.entry_at) === month,
  );
  const monthPnl = trades.reduce(
    (sum, trade) => sum + (trade.pnl_inr ?? 0),
    0,
  );

  return {
    paper: {
      ...paper,
      trades,
    },
    month,
    months,
    monthPnl,
    monthLabel: formatMonthLabel(month),
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

export default function PaperPage({ loaderData }: Route.ComponentProps) {
  const { paper, month, months, monthPnl, monthLabel } = loaderData;
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
            Always on while the server is running. Entries 10:00–14:00 IST on
            each index&apos;s expiry. Simulation only — no real orders.
          </p>
        </header>

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
            <form method="get" className="sm:w-48">
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium tracking-wide text-slate-500 uppercase">
                  Month
                </span>
                <select
                  name="month"
                  defaultValue={month}
                  onChange={(event) => event.currentTarget.form?.requestSubmit()}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                >
                  {months.map((value) => (
                    <option key={value} value={value}>
                      {formatMonthLabel(value)}
                    </option>
                  ))}
                </select>
              </label>
            </form>
          </div>

          <PaperTradesList trades={paper.trades} />
        </section>
      </div>
    </main>
  );
}
