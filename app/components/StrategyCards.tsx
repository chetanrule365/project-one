import type { CreditSpread } from "../lib/dhan/strategies";

function formatNumber(value: number, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-1 font-semibold tabular-nums text-slate-900 dark:text-slate-100">
        {value}
      </dd>
    </div>
  );
}

function StrategyCard({ spread }: { spread: CreditSpread }) {
  const legsLabel =
    spread.legs.length > 0
      ? spread.legs
          .map(
            (l) =>
              `${l.qty < 0 ? "Sell" : "Buy"} ${l.strike} ${l.right}`,
          )
          .join(" · ")
      : `Sell ${spread.primaryShortStrike} ${spread.primaryShortSide} · Buy ${spread.primaryLongStrike} ${spread.primaryLongSide}`;

  return (
    <article className="rounded-2xl border border-slate-200 bg-white/90 p-5 dark:border-slate-800 dark:bg-slate-900/70">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
            {spread.name}
          </h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {spread.bias}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            spread.available
              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
              : "bg-slate-500/15 text-slate-600 dark:text-slate-300"
          }`}
        >
          {spread.available ? "Eligible" : "Sit out"}
        </span>
      </div>

      <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
        {spread.description}
      </p>

      <p className="mt-4 text-sm font-medium tabular-nums text-slate-800 dark:text-slate-200">
        {legsLabel}
      </p>

      {spread.available ? (
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric
            label={spread.netCredit >= 0 ? "Net credit" : "Net debit"}
            value={formatNumber(Math.abs(spread.netCredit))}
          />
          <Metric label="Max profit" value={formatNumber(spread.maxProfit)} />
          <Metric label="Max loss" value={formatNumber(spread.maxLoss)} />
          <Metric label="Width" value={formatNumber(spread.width, 0)} />
        </dl>
      ) : (
        <p className="mt-4 text-sm text-amber-700 dark:text-amber-300">
          {spread.reason ?? "Not eligible right now"}
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
}: {
  spreads: CreditSpread[];
  widthSteps: number;
  action: string;
  expiry: string;
}) {
  return (
    <section className="mb-8">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
            Expiry-day playbook
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            ORB, iron condor, max-pain, and OI fade — eligibility uses live
            chain + clock (best on Tuesday 10:00–14:00 IST).
          </p>
        </div>

        <form method="get" action={action} className="flex items-center gap-2">
          <input type="hidden" name="expiry" value={expiry} />
          <label
            htmlFor="width"
            className="text-sm text-slate-500 dark:text-slate-400"
          >
            Wing width
          </label>
          <select
            id="width"
            name="width"
            defaultValue={String(widthSteps)}
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            {[1, 2, 3, 4].map((step) => (
              <option key={step} value={step}>
                {step} strike{step > 1 ? "s" : ""}
              </option>
            ))}
          </select>
        </form>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {spreads.map((spread) => (
          <StrategyCard key={spread.id} spread={spread} />
        ))}
      </div>
    </section>
  );
}
