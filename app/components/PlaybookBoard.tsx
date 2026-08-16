import type { CreditSpread } from "../lib/dhan/strategies";
import type { DayStructure } from "../lib/strategies/types";

type PlaybookBoardProps = {
  spreads: CreditSpread[];
  structure: DayStructure;
  hour: number;
  isExpiryDay: boolean;
  inEntryWindow: boolean;
  pick: { strategyId: string; name: string; reason: string } | null;
  sitReason?: string | null;
  spot: number;
};

function formatNumber(value: number, digits = 0) {
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

function clockLabel(hour: number) {
  return `${String(hour).padStart(2, "0")}:xx IST`;
}

function LevelsStrip({
  structure,
  spot,
}: {
  structure: DayStructure;
  spot: number;
}) {
  const levels = [
    { key: "priorLow", label: "Prior low", value: structure.priorLow },
    { key: "put", label: "Put support", value: structure.putOiSupport },
    { key: "open", label: "Open", value: structure.open },
    { key: "spot", label: "Spot", value: spot, accent: true },
    { key: "maxPain", label: "Max pain", value: structure.maxPain },
    { key: "call", label: "Call resist", value: structure.callOiResistance },
    { key: "priorHigh", label: "Prior high", value: structure.priorHigh },
  ].filter((l) => l.value != null && Number.isFinite(l.value as number));

  const ranked = [...levels].sort(
    (a, b) => (b.value as number) - (a.value as number),
  );
  const values = levels.map((l) => l.value as number);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
          Levels
        </h3>
        {structure.distToMaxPain != null ? (
          <p className="text-[11px] tabular-nums text-slate-500">
            {formatNumber(structure.distToMaxPain)} pts from max pain
          </p>
        ) : null}
      </div>

      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-950/40">
        {ranked.map((level) => {
          const pct = ((level.value as number) - min) / span;
          return (
            <li
              key={level.key}
              className={`grid grid-cols-[minmax(4.5rem,7rem)_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2.5 sm:gap-3 ${
                level.accent ? "bg-sky-50/80 dark:bg-sky-950/30" : ""
              }`}
            >
              <span
                className={`truncate text-sm ${
                  level.accent
                    ? "font-semibold text-sky-800 dark:text-sky-200"
                    : "text-slate-600 dark:text-slate-400"
                }`}
              >
                {level.label}
              </span>
              <div className="relative h-1.5 rounded-full bg-slate-100 dark:bg-slate-800">
                <span
                  className={`absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${
                    level.accent
                      ? "border-sky-600 bg-sky-400"
                      : "border-slate-400 bg-white dark:bg-slate-900"
                  }`}
                  style={{ left: `${Math.min(100, Math.max(0, pct * 100))}%` }}
                />
              </div>
              <span
                className={`min-w-[4.5rem] text-right text-sm tabular-nums ${
                  level.accent
                    ? "font-semibold text-sky-900 dark:text-sky-100"
                    : "text-slate-900 dark:text-slate-100"
                }`}
              >
                {formatNumber(level.value as number)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function StructureChips({ structure }: { structure: DayStructure }) {
  const chips: Array<{
    label: string;
    on: boolean;
    tone: "go" | "warn";
  }> = [
    { label: "Quiet day", on: structure.quietDay, tone: "go" },
    { label: "Inside range", on: structure.insidePriorRange, tone: "go" },
    { label: "ORB up", on: structure.orbBrokenUp, tone: "warn" },
    { label: "ORB down", on: structure.orbBrokenDown, tone: "warn" },
  ];

  return (
    <section>
      <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
        Structure
      </h3>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {chips.map((chip) => (
          <span
            key={chip.label}
            className={`rounded-xl px-3 py-2 text-center text-xs font-medium sm:text-left ${
              chip.on
                ? chip.tone === "warn"
                  ? "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
                  : "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200"
                : "bg-slate-100 text-slate-400 dark:bg-slate-900 dark:text-slate-500"
            }`}
          >
            {chip.on ? "● " : "○ "}
            {chip.label}
          </span>
        ))}
      </div>
    </section>
  );
}

function SetupCard({
  spread,
  picked,
}: {
  spread: CreditSpread;
  picked: boolean;
}) {
  const status = picked ? "picked" : spread.available ? "eligible" : "blocked";

  return (
    <article
      className={`rounded-2xl border p-3.5 ${
        status === "picked"
          ? "border-sky-400 bg-sky-50 ring-1 ring-sky-300 dark:border-sky-600 dark:bg-sky-950/30 dark:ring-sky-800"
          : status === "eligible"
            ? "border-emerald-200 bg-white dark:border-emerald-900/60 dark:bg-emerald-950/15"
            : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950/30"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            {spread.name}
          </h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {spread.bias}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
            status === "picked"
              ? "bg-sky-600 text-white"
              : status === "eligible"
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
                : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
          }`}
        >
          {status === "picked" ? "Pick" : status === "eligible" ? "Go" : "No"}
        </span>
      </div>

      {spread.available ? (
        <>
          <p className="mt-3 text-sm tabular-nums text-slate-700 dark:text-slate-200">
            {shortLegs(spread)}
          </p>
          <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
            <div>
              <dt className="text-[10px] tracking-wide text-slate-400 uppercase">
                {spread.netCredit >= 0 ? "Credit" : "Debit"}
              </dt>
              <dd className="mt-0.5 text-sm font-medium tabular-nums text-slate-900 dark:text-white">
                {formatNumber(Math.abs(spread.netCredit), 2)}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] tracking-wide text-slate-400 uppercase">
                Max
              </dt>
              <dd className="mt-0.5 text-sm font-medium tabular-nums text-slate-900 dark:text-white">
                {formatNumber(spread.maxProfit, 2)}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] tracking-wide text-slate-400 uppercase">
                Risk
              </dt>
              <dd className="mt-0.5 text-sm font-medium tabular-nums text-slate-900 dark:text-white">
                {formatNumber(spread.maxLoss, 2)}
              </dd>
            </div>
          </dl>
        </>
      ) : (
        <p className="mt-3 text-sm leading-snug text-amber-800 dark:text-amber-300">
          {spread.reason ?? "Not eligible"}
        </p>
      )}
    </article>
  );
}

export function PlaybookBoard({
  spreads,
  structure,
  hour,
  isExpiryDay,
  inEntryWindow,
  pick,
  sitReason,
  spot,
}: PlaybookBoardProps) {
  return (
    <div className="space-y-5">
      <section
        className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3 py-2.5 ${
          pick
            ? "border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/30"
            : "border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/40"
        }`}
      >
        <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
          Auto pick
        </p>
        <p className="text-sm font-semibold text-slate-900 dark:text-white">
          {pick ? pick.name : "Sit out"}
        </p>
        <p
          className={`min-w-0 flex-1 text-sm ${
            pick
              ? "text-sky-900 dark:text-sky-200"
              : "text-slate-500 dark:text-slate-400"
          }`}
        >
          {pick
            ? pick.reason
            : (sitReason ?? "No setup matches current structure.")}
        </p>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
            isExpiryDay
              ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200"
              : "bg-slate-200/80 text-slate-500 dark:bg-slate-900 dark:text-slate-400"
          }`}
        >
          {isExpiryDay ? "Expiry today" : "Not expiry"}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
            inEntryWindow
              ? "bg-sky-100 text-sky-900 dark:bg-sky-950/60 dark:text-sky-200"
              : "bg-slate-200/80 text-slate-500 dark:bg-slate-900 dark:text-slate-400"
          }`}
        >
          {inEntryWindow ? "In window" : "Outside window"} · {clockLabel(hour)}
        </span>
      </section>

      <StructureChips structure={structure} />
      <LevelsStrip structure={structure} spot={spot} />

      <section>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h3 className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
            Setups
          </h3>
          <p className="text-[11px] text-slate-400">Checked in this order</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {spreads.map((spread) => (
            <SetupCard
              key={spread.id}
              spread={spread}
              picked={pick?.strategyId === spread.id}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
