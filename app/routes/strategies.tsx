import type { Route } from "./+types/strategies";
import { Link } from "react-router";
import { PlaybookBoard } from "../components/PlaybookBoard";
import { INDEX_INSTRUMENTS, getIndexByParam } from "../lib/dhan/instruments";
import { loadOptionChainPage } from "../lib/dhan/option-chain";
import {
  DhanApiError,
  DhanConfigError,
  fetchIndexQuotes,
} from "../lib/dhan/quotes";
import { buildPlaybookSnapshot, type PlaybookSnapshot } from "../lib/dhan/strategies";
import { ensurePaperWorker } from "../lib/lab/paper-worker";
import { DEFAULT_WIDTH_STEPS } from "../lib/strategies/types";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Playbook" },
    {
      name: "description",
      content: "Live playbook for Nifty, Bank Nifty, and Sensex",
    },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  ensurePaperWorker();
  const url = new URL(request.url);
  const instrumentId = String(url.searchParams.get("instrument") ?? "NIFTY");
  const instrument = getIndexByParam(instrumentId) ?? INDEX_INSTRUMENTS[0];
  const widthParam = Number(url.searchParams.get("width") ?? DEFAULT_WIDTH_STEPS);
  const widthSteps = Number.isFinite(widthParam) ? Math.max(1, Math.min(5, Math.floor(widthParam))) : DEFAULT_WIDTH_STEPS;
  const requestedExpiry = url.searchParams.get("expiry");

  let snapshot: PlaybookSnapshot | null = null;
  let expiry = "";
  let playbookError: string | null = null;
  let spot: number | null = null;

  try {
    const chain = await loadOptionChainPage(instrument, requestedExpiry);
    let quote: { open: number; high: number; low: number; prevClose: number } | undefined;
    try {
      const quotes = await fetchIndexQuotes();
      const match = quotes.find((q) => q.id === instrument.id);
      if (match) {
        quote = { open: match.open, high: match.high, low: match.low, prevClose: match.prevClose };
      }
    } catch {
      quote = undefined;
    }

    snapshot = buildPlaybookSnapshot(chain.rows, chain.spot, widthSteps, quote, instrument);
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
    playbook: {
      instrument,
      snapshot,
      widthSteps,
      expiry,
      spot,
      error: playbookError,
    },
  };
}

function formatNumber(value: number, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export default function StrategiesPage(props: Route.ComponentProps) {
  const loaderData = props.loaderData ?? {
    instruments: INDEX_INSTRUMENTS,
    playbook: {
      instrument: INDEX_INSTRUMENTS[0],
      snapshot: null,
      widthSteps: DEFAULT_WIDTH_STEPS,
      expiry: "",
      spot: null,
      error: null,
    },
  };
  const { playbook } = loaderData;

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100 px-3 py-4 sm:px-4 sm:py-8 dark:from-gray-950 dark:via-gray-950 dark:to-gray-900">
      <div className="mx-auto max-w-6xl">
        <header className="mb-4 sm:mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl dark:text-white">Playbook</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-snug text-slate-500 dark:text-slate-400">
            Live setups for Nifty, Bank Nifty, and Sensex. Simulation only — no real orders. {" "}
            <Link to="/paper" className="font-medium text-sky-700 underline-offset-2 hover:underline dark:text-sky-300">Paper trades</Link>
          </p>
        </header>

        <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-3 sm:mb-8 sm:p-4 dark:border-slate-800 dark:bg-slate-900/70">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-lg font-semibold text-slate-900 dark:text-white">{playbook.instrument.name}</p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{playbook.expiry ? playbook.expiry : "No expiry loaded"}</p>
            </div>
            <form method="get" className="grid grid-cols-2 gap-2 sm:flex sm:items-end">
              {playbook.expiry ? <input type="hidden" name="expiry" value={playbook.expiry} /> : null}
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium tracking-wide text-slate-500 uppercase">Index</span>
                <select name="instrument" defaultValue={playbook.instrument.id} onChange={(event) => event.currentTarget.form?.requestSubmit()} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm sm:w-40 dark:border-slate-700 dark:bg-slate-950">
                  {loaderData.instruments.map((instrument) => (
                    <option key={instrument.id} value={instrument.id}>{instrument.name}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium tracking-wide text-slate-500 uppercase">Width</span>
                <select name="width" defaultValue={String(playbook.widthSteps)} onChange={(event) => event.currentTarget.form?.requestSubmit()} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm sm:w-20 dark:border-slate-700 dark:bg-slate-950">
                  {[1, 2, 3, 4].map((step) => (
                    <option key={step} value={step}>{step}</option>
                  ))}
                </select>
              </label>
            </form>
          </div>

          {playbook.error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">{playbook.error}</div>
          ) : playbook.snapshot && playbook.expiry && playbook.spot != null ? (
            <PlaybookBoard
              spreads={playbook.snapshot.spreads}
              structure={playbook.snapshot.structure}
              hour={playbook.snapshot.hour}
              isExpiryDay={playbook.snapshot.isExpiryDay}
              inEntryWindow={playbook.snapshot.inEntryWindow}
              pick={playbook.snapshot.pick}
              sitReason={playbook.snapshot.sitReason}
              spot={playbook.spot}
            />
          ) : (
            <p className="text-sm text-slate-500">Loading playbook…</p>
          )}
        </section>
      </div>
    </main>
  );
}
