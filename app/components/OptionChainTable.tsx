import { Link } from "react-router";
import type { OptionChainRow, OptionSide } from "../lib/dhan/option-chain";

function formatNumber(value: number, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatInt(value: number) {
  if (!Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString("en-IN");
}

function SideCells({
  side,
  order,
}: {
  side: OptionSide | null;
  order: "ce" | "pe";
}) {
  const values = side
    ? order === "ce"
      ? [formatInt(side.oi), formatNumber(side.lastPrice), formatNumber(side.iv, 1)]
      : [formatNumber(side.iv, 1), formatNumber(side.lastPrice), formatInt(side.oi)]
    : ["—", "—", "—"];

  const align = order === "ce" ? "text-right" : "text-left";

  return (
    <>
      {values.map((value, index) => (
        <td
          key={`${order}-${index}`}
          className={`px-2 py-2 tabular-nums ${align}`}
        >
          {value}
        </td>
      ))}
    </>
  );
}

export function OptionChainTable({
  rows,
  spot,
}: {
  rows: OptionChainRow[];
  spot: number;
}) {
  const atmStrike =
    rows.length === 0
      ? null
      : rows.reduce((closest, row) =>
          Math.abs(row.strike - spot) < Math.abs(closest.strike - spot)
            ? row
            : closest,
        ).strike;

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white/90 dark:border-slate-800 dark:bg-slate-900/70">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-xs tracking-wide text-slate-500 uppercase dark:bg-slate-900 dark:text-slate-400">
          <tr>
            <th className="px-2 py-3 text-right font-medium" colSpan={3}>
              Call (CE)
            </th>
            <th className="px-2 py-3 text-center font-medium">Strike</th>
            <th className="px-2 py-3 text-left font-medium" colSpan={3}>
              Put (PE)
            </th>
          </tr>
          <tr>
            <th className="px-2 py-2 text-right font-medium">OI</th>
            <th className="px-2 py-2 text-right font-medium">LTP</th>
            <th className="px-2 py-2 text-right font-medium">IV</th>
            <th className="px-2 py-2 text-center font-medium" />
            <th className="px-2 py-2 text-left font-medium">IV</th>
            <th className="px-2 py-2 text-left font-medium">LTP</th>
            <th className="px-2 py-2 text-left font-medium">OI</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isAtm = row.strike === atmStrike;
            return (
              <tr
                key={row.strike}
                className={
                  isAtm
                    ? "bg-amber-50/80 dark:bg-amber-950/30"
                    : "border-t border-slate-100 dark:border-slate-800"
                }
              >
                <SideCells side={row.ce} order="ce" />
                <td className="px-2 py-2 text-center font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {formatNumber(row.strike, 0)}
                </td>
                <SideCells side={row.pe} order="pe" />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ExpirySelect({
  expiries,
  selected,
  action,
}: {
  expiries: string[];
  selected: string;
  action: string;
}) {
  return (
    <form method="get" action={action} className="flex items-center gap-2">
      <label
        htmlFor="expiry"
        className="text-sm text-slate-500 dark:text-slate-400"
      >
        Expiry
      </label>
      <select
        id="expiry"
        name="expiry"
        defaultValue={selected}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      >
        {expiries.map((expiry) => (
          <option key={expiry} value={expiry}>
            {expiry}
          </option>
        ))}
      </select>
    </form>
  );
}

export function BackToWatch() {
  return (
    <Link
      to="/"
      className="text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
    >
      ← Market Watch
    </Link>
  );
}
