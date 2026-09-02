type LiveLeg = {
  right: string;
  strike: number;
  qty: number;
  premium: number;
};

export type LiveTrade = {
  id: number;
  instrument_id?: string;
  strategy_id: string;
  short_strike: number;
  long_strike: number;
  short_side: string;
  credit: number;
  margin_inr?: number;
  spot_entry: number;
  mark_spot?: number | null;
  mark_pnl_inr?: number | null;
  mark_at?: string | null;
  entry_at: string;
  legs?: LiveLeg[];
};

function formatNumber(value: number, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatSignedInr(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  const formatted = Math.abs(value).toLocaleString("en-IN", {
    maximumFractionDigits: 0,
  });
  if (value > 0) return `+₹ ${formatted}`;
  if (value < 0) return `−₹ ${formatted}`;
  return `₹ ${formatted}`;
}

function formatLegs(trade: LiveTrade) {
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

function formatPremium(credit: number) {
  const label = credit >= 0 ? "Cr" : "Db";
  return `${label} ${formatNumber(Math.abs(credit))}`;
}

function formatIstTime(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function pnlClass(pnl: number | null | undefined) {
  if (pnl == null) return "text-slate-500";
  if (pnl > 0) return "text-emerald-600 dark:text-emerald-400";
  if (pnl < 0) return "text-rose-600 dark:text-rose-400";
  return "text-slate-500";
}

function rowAccent(pnl: number | null | undefined) {
  if (pnl == null) return "border-l-2 border-l-sky-400";
  if (pnl > 0) return "border-l-2 border-l-emerald-500";
  if (pnl < 0) return "border-l-2 border-l-rose-500";
  return "border-l-2 border-l-slate-300 dark:border-l-slate-700";
}

function LiveDot() {
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0" title="Live">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
    </span>
  );
}

export function LivePaperTrades({
  trades,
  totalPnlInr,
  asOf,
}: {
  trades: LiveTrade[];
  totalPnlInr: number;
  asOf: string | null;
}) {
  const asOfLabel = formatIstTime(asOf);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 dark:border-slate-800 dark:bg-slate-900/70">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
            <LiveDot />
            Live paper trades
          </p>
          <p className="mt-0.5 text-xs text-slate-400">
            Open positions, marked to the latest option prices — simulation only.
          </p>
        </div>
        {trades.length > 0 ? (
          <div className="text-right">
            <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              Live P&L
            </p>
            <p className={`text-xl font-semibold tabular-nums ${pnlClass(totalPnlInr)}`}>
              {formatSignedInr(totalPnlInr)}
            </p>
            {asOfLabel ? (
              <p className="text-[11px] text-slate-400">as of {asOfLabel}</p>
            ) : null}
          </div>
        ) : null}
      </div>

      {trades.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          No live paper trades right now. New entries are taken 10:00–14:00 IST
          on each index&apos;s expiry.
        </p>
      ) : (
        <>
          <ul className="space-y-2 md:hidden">
            {trades.map((trade) => (
              <li
                key={trade.id}
                className={`rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-800 ${rowAccent(trade.mark_pnl_inr)}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                      <LiveDot />
                      {trade.instrument_id ?? "—"}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {trade.strategy_id}
                    </p>
                  </div>
                  <span
                    className={`text-sm font-medium tabular-nums ${pnlClass(trade.mark_pnl_inr)}`}
                  >
                    {trade.mark_pnl_inr == null
                      ? "…"
                      : formatSignedInr(trade.mark_pnl_inr)}
                  </span>
                </div>
                <p className="mt-2 text-xs tabular-nums text-slate-600 dark:text-slate-300">
                  {formatLegs(trade)}
                  <span className="text-slate-400"> · </span>
                  {formatPremium(trade.credit)}
                </p>
                <p className="mt-1 text-xs tabular-nums text-slate-400">
                  Spot {formatNumber(trade.spot_entry, 0)}
                  {trade.mark_spot != null
                    ? ` → ${formatNumber(trade.mark_spot, 0)}`
                    : ""}
                </p>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 md:block">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs tracking-wide text-slate-500 uppercase dark:bg-slate-900 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left">Index</th>
                  <th className="px-3 py-2 text-left">Path</th>
                  <th className="px-3 py-2 text-right">Legs</th>
                  <th className="px-3 py-2 text-right">Premium</th>
                  <th className="px-3 py-2 text-right">Spot</th>
                  <th className="px-3 py-2 text-right">Live P&L ₹</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((trade) => (
                  <tr
                    key={trade.id}
                    className={`border-t border-slate-100 dark:border-slate-800 ${rowAccent(trade.mark_pnl_inr)}`}
                  >
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-2">
                        <LiveDot />
                        {trade.instrument_id ?? "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2">{trade.strategy_id}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatLegs(trade)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatPremium(trade.credit)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatNumber(trade.spot_entry, 0)}
                      {trade.mark_spot != null
                        ? ` → ${formatNumber(trade.mark_spot, 0)}`
                        : ""}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-medium tabular-nums ${pnlClass(trade.mark_pnl_inr)}`}
                    >
                      {trade.mark_pnl_inr == null
                        ? "…"
                        : formatSignedInr(trade.mark_pnl_inr)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
