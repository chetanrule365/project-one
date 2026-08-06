import type { Route } from "./+types/index.$id";
import {
  BackToWatch,
  ExpirySelect,
  OptionChainTable,
} from "../components/OptionChainTable";
import { StrategyCards } from "../components/StrategyCards";
import { getIndexByParam } from "../lib/dhan/instruments";
import { loadOptionChainPage } from "../lib/dhan/option-chain";
import { DhanApiError, DhanConfigError } from "../lib/dhan/quotes";
import { buildCreditSpreads } from "../lib/dhan/strategies";

export function meta({ data }: Route.MetaArgs) {
  const name = data?.instrument?.name ?? "Index";
  return [
    { title: `${name} Option Chain` },
    { name: "description", content: `Option chain for ${name}` },
  ];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const instrument = getIndexByParam(params.id);
  if (!instrument) {
    throw new Response("Index not found", { status: 404 });
  }

  const url = new URL(request.url);
  const requestedExpiry = url.searchParams.get("expiry");
  const widthParam = Number(url.searchParams.get("width") ?? "2");
  const widthSteps = Number.isFinite(widthParam)
    ? Math.max(1, Math.min(5, Math.floor(widthParam)))
    : 2;

  try {
    const chain = await loadOptionChainPage(instrument, requestedExpiry);
    const spreads = buildCreditSpreads(chain.rows, chain.spot, widthSteps);
    return {
      instrument,
      chain,
      spreads,
      widthSteps,
      error: null as string | null,
    };
  } catch (error) {
    const message =
      error instanceof DhanConfigError || error instanceof DhanApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Failed to load option chain";

    return {
      instrument,
      chain: null,
      spreads: [],
      widthSteps,
      error: message,
    };
  }
}

function formatNumber(value: number, digits = 2) {
  return value.toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export default function IndexOptionChain({
  loaderData,
}: Route.ComponentProps) {
  const { instrument, chain, spreads, widthSteps, error } = loaderData;
  const action = `/index/${instrument.id.toLowerCase()}`;

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100 px-4 py-8 dark:from-gray-950 dark:via-gray-950 dark:to-gray-900">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6">
          <BackToWatch />
        </div>

        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium tracking-wide text-slate-500 uppercase">
              Option Chain
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
              {instrument.name}
            </h1>
            {chain ? (
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                Spot{" "}
                <span className="font-medium tabular-nums text-slate-800 dark:text-slate-200">
                  {formatNumber(chain.spot)}
                </span>
              </p>
            ) : null}
          </div>

          {chain ? (
            <ExpirySelect
              expiries={chain.expiries}
              selected={chain.expiry}
              action={action}
              widthSteps={widthSteps}
            />
          ) : null}
        </header>

        {error ? (
          <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
            {error}
          </div>
        ) : null}

        {chain ? (
          <>
            <StrategyCards
              spreads={spreads}
              widthSteps={widthSteps}
              action={action}
              expiry={chain.expiry}
            />
            <OptionChainTable rows={chain.rows} spot={chain.spot} />
          </>
        ) : !error ? (
          <p className="text-slate-500">Loading option chain…</p>
        ) : null}
      </div>
    </main>
  );
}
