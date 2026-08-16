type PaperLeg = {
  right: string;
  strike: number;
  qty: number;
  premium: number;
};

type PaperTradeRow = {
  id: number;
  instrument_id?: string;
  strategy_id: string;
  status: string;
  short_strike: number;
  long_strike: number;
  short_side: string;
  credit: number;
  capital_inr?: number;
  pnl_inr: number | null;
  entry_at: string;
  exit_at?: string | null;
  legs?: PaperLeg[];
};

function formatNumber(value: number, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatLegs(trade: PaperTradeRow) {
  if (trade.legs && trade.legs.length > 0) {
    return trade.legs
      .map((leg) => `${leg.qty < 0 ? "S" : "B"} ${leg.strike}${leg.right}`)
      .join(" · ");
  }
  if (trade.credit < 0 && trade.short_strike === trade.long_strike) {
    return `B ${trade.short_strike}${trade.short_side}`;
  }
  return `${trade.short_strike}/${trade.long_strike} ${trade.short_side}`;
}

function formatIstDate(date: Date) {
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatIstTime(date: Date) {
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function formatWhen(trade: PaperTradeRow) {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trade.entry_at);
  if (!dateOnly) {
    const entered = new Date(trade.entry_at);
    if (Number.isFinite(entered.getTime())) {
      return `${formatIstDate(entered)}, ${formatIstTime(entered)}`;
    }
  }
  const day = formatIstDate(new Date(`${trade.entry_at}T12:00:00+05:30`));
  if (trade.exit_at) {
    const exited = new Date(trade.exit_at);
    if (Number.isFinite(exited.getTime())) {
      return `${day} · closed ${formatIstTime(exited)}`;
    }
  }
  return day;
}

function formatPremium(credit: number) {
  const label = credit >= 0 ? "Cr" : "Db";
  return `${label} ${formatNumber(Math.abs(credit))}`;
}

function ActiveDot() {
  return (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.25)]"
      title="Active"
    />
  );
}

function pnlClass(pnl: number | null) {
  if (pnl == null) return "text-slate-500";
  if (pnl > 0) return "text-emerald-600 dark:text-emerald-400";
  if (pnl < 0) return "text-rose-600 dark:text-rose-400";
  return "text-slate-500";
}

function rowAccent(pnl: number | null, status: string) {
  if (status === "open" || pnl == null) {
    return "border-l-2 border-l-sky-400";
  }
  if (pnl > 0) return "border-l-2 border-l-emerald-500";
  if (pnl < 0) return "border-l-2 border-l-rose-500";
  return "border-l-2 border-l-slate-300 dark:border-l-slate-700";
}

export function PaperTradesList({ trades }: { trades: PaperTradeRow[] }) {
  if (trades.length === 0) {
    return (
      <p className="mt-4 text-sm text-slate-500">
        No paper trades in this month.
      </p>
    );
  }

  return (
    <>
      <ul className="mt-4 space-y-2 md:hidden">
        {trades.map((trade) => (
          <li
            key={trade.id}
            className={`rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-800 ${rowAccent(trade.pnl_inr, trade.status)}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                  {trade.status === "open" ? <ActiveDot /> : null}
                  {trade.instrument_id ?? "—"}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {trade.strategy_id}
                </p>
              </div>
              <span
                className={`text-sm font-medium tabular-nums ${pnlClass(trade.pnl_inr)}`}
              >
                {trade.pnl_inr === null
                  ? "Open"
                  : `₹ ${formatNumber(trade.pnl_inr, 0)}`}
              </span>
            </div>
            <p className="mt-2 text-xs tabular-nums text-slate-600 dark:text-slate-300">
              {formatLegs(trade)}
              <span className="text-slate-400"> · </span>
              {formatPremium(trade.credit)}
              {trade.capital_inr != null ? (
                <>
                  <span className="text-slate-400"> · </span>
                  Cap ₹ {formatNumber(trade.capital_inr, 0)}
                </>
              ) : null}
            </p>
            <p className="mt-1 text-xs tabular-nums text-slate-400">
              {formatWhen(trade)}
            </p>
          </li>
        ))}
      </ul>
      <div className="mt-4 hidden overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 md:block">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs tracking-wide text-slate-500 uppercase dark:bg-slate-900 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">Index</th>
              <th className="px-3 py-2 text-left">Path</th>
              <th className="px-3 py-2 text-left">Entry</th>
              <th className="px-3 py-2 text-right">Legs</th>
              <th className="px-3 py-2 text-right">Premium</th>
              <th className="px-3 py-2 text-right">Capital ₹</th>
              <th className="px-3 py-2 text-right">P&L ₹</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade) => (
              <tr
                key={trade.id}
                className={`border-t border-slate-100 dark:border-slate-800 ${rowAccent(trade.pnl_inr, trade.status)}`}
              >
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-2">
                    {trade.status === "open" ? <ActiveDot /> : null}
                    {trade.instrument_id ?? "—"}
                  </span>
                </td>
                <td className="px-3 py-2">{trade.strategy_id}</td>
                <td className="px-3 py-2 tabular-nums">
                  {formatWhen(trade)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatLegs(trade)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatPremium(trade.credit)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {trade.capital_inr == null
                    ? "—"
                    : formatNumber(trade.capital_inr, 0)}
                </td>
                <td
                  className={`px-3 py-2 text-right font-medium tabular-nums ${pnlClass(trade.pnl_inr)}`}
                >
                  {trade.pnl_inr === null
                    ? "—"
                    : formatNumber(trade.pnl_inr, 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
