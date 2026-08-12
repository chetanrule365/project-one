import { Link } from "react-router";
import type { IndexQuote } from "../lib/dhan/instruments";

function formatNumber(value: number, digits = 2) {
  return value.toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatSigned(value: number, digits = 2) {
  const formatted = formatNumber(Math.abs(value), digits);
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

export function IndexCard({ quote }: { quote: IndexQuote }) {
  const isUp = quote.change > 0;
  const isDown = quote.change < 0;
  const tone = isUp
    ? "text-emerald-600 dark:text-emerald-400"
    : isDown
      ? "text-rose-600 dark:text-rose-400"
      : "text-gray-600 dark:text-gray-300";

  return (
    <Link
      to={`/option-chain/${quote.id.toLowerCase()}`}
      className="block rounded-2xl border border-gray-200 bg-white/80 p-5 shadow-sm transition hover:border-slate-400 hover:shadow-md dark:border-gray-800 dark:bg-gray-900/70 dark:hover:border-slate-600"
    >
      <article>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium tracking-wide text-gray-500 uppercase dark:text-gray-400">
              {quote.name}
            </h2>
            <p className="mt-2 text-3xl font-semibold tabular-nums text-gray-900 dark:text-gray-50">
              {formatNumber(quote.price)}
            </p>
          </div>
          <div className={`text-right text-sm font-medium tabular-nums ${tone}`}>
            <p>{formatSigned(quote.change)}</p>
            <p>{formatSigned(quote.changePercent)}%</p>
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-3 gap-3 text-xs text-gray-500 dark:text-gray-400">
          <div>
            <dt>Open</dt>
            <dd className="mt-1 font-medium tabular-nums text-gray-800 dark:text-gray-200">
              {formatNumber(quote.open)}
            </dd>
          </div>
          <div>
            <dt>High</dt>
            <dd className="mt-1 font-medium tabular-nums text-gray-800 dark:text-gray-200">
              {formatNumber(quote.high)}
            </dd>
          </div>
          <div>
            <dt>Low</dt>
            <dd className="mt-1 font-medium tabular-nums text-gray-800 dark:text-gray-200">
              {formatNumber(quote.low)}
            </dd>
          </div>
        </dl>

        <p className="mt-4 text-xs font-medium text-slate-500 dark:text-slate-400">
          View option chain →
        </p>
      </article>
    </Link>
  );
}
