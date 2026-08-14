import type { CreditSpread } from "../lib/dhan/strategies";

function formatNumber(value: number, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function shortLegs(spread: CreditSpread) {
  if (spread.legs.length > 0) {
    return spread.legs
      .map((l) => `${l.qty < 0 ? "S" : "B"} ${l.strike}${l.right}`)
      .join(" · ");
  }
  if (!spread.available) return "—";
  return `S ${spread.primaryShortStrike}${spread.primaryShortSide} · B ${spread.primaryLongStrike}${spread.primaryLongSide}`;
}

function StrategyCard({ spread }: { spread: CreditSpread }) {
  return (
    <article
      className={`rounded-lg border px-3 py-2.5 ${
        spread.available
          ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/60 dark:bg-emerald-950/20"
          : "border-slate-200 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-900/40"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-white">
          {spread.name}
        </h3>
        <span
          className={`shrink-0 text-[11px] font-medium ${
            spread.available
              ? "text-emerald-700 dark:text-emerald-300"
              : "text-slate-500 dark:text-slate-400"
          }`}
        >
          {spread.available ? "Go" : "Sit"}
        </span>
      </div>

      <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
        {spread.bias}
      </p>

      {spread.available ? (
        <>
          <p className="mt-1.5 truncate text-xs tabular-nums text-slate-700 dark:text-slate-200">
            {shortLegs(spread)}
          </p>
          <p className="mt-1 text-[11px] tabular-nums text-slate-600 dark:text-slate-300">
            {spread.netCredit >= 0 ? "Cr" : "Db"}{" "}
            {formatNumber(Math.abs(spread.netCredit))}
            <span className="text-slate-400"> · </span>
            Max {formatNumber(spread.maxProfit)}
            <span className="text-slate-400"> · </span>
            Risk {formatNumber(spread.maxLoss)}
          </p>
        </>
      ) : (
        <p className="mt-1.5 line-clamp-2 text-[11px] text-amber-700 dark:text-amber-300">
          {spread.reason ?? "Not eligible"}
        </p>
      )}
    </article>
  );
}

export function StrategyCards({
  spreads,
  widthSteps,
  action,
  expiry,
  hideHeader = false,
}: {
  spreads: CreditSpread[];
  widthSteps: number;
  action: string;
  expiry: string;
  hideHeader?: boolean;
}) {
  return (
    <section className={hideHeader ? undefined : "mb-6"}>
      {!hideHeader ? (
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Weekday playbook
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              10:00–14:00 IST · expiry sells premium first; other days prefer ORB
            </p>
          </div>

          <form method="get" action={action} className="flex items-center gap-2">
            <input type="hidden" name="expiry" value={expiry} />
            <label
              htmlFor="width"
              className="text-xs text-slate-500 dark:text-slate-400"
            >
              Width
            </label>
            <select
              id="width"
              name="width"
              defaultValue={String(widthSteps)}
              onChange={(event) => event.currentTarget.form?.requestSubmit()}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {[1, 2, 3, 4].map((step) => (
                <option key={step} value={step}>
                  {step}
                </option>
              ))}
            </select>
          </form>
        </div>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {spreads.map((spread) => (
          <StrategyCard key={spread.id} spread={spread} />
        ))}
      </div>
    </section>
  );
}
