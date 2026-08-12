import { Link } from "react-router";
import type { Route } from "./+types/option-chain.$id";
import { AppNav } from "../components/AppNav";
import {
  ExpirySelect,
  OptionChainTable,
} from "../components/OptionChainTable";
import { INDEX_INSTRUMENTS, getIndexByParam } from "../lib/dhan/instruments";
import { loadOptionChainPage } from "../lib/dhan/option-chain";
import { DhanApiError, DhanConfigError } from "../lib/dhan/quotes";

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

  try {
    const chain = await loadOptionChainPage(instrument, requestedExpiry);
    return {
      instrument,
      chain,
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

export default function OptionChainPage({
  loaderData,
}: Route.ComponentProps) {
  const { instrument, chain, error } = loaderData;
  const action = `/option-chain/${instrument.id.toLowerCase()}`;

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100 px-4 py-8 dark:from-gray-950 dark:via-gray-950 dark:to-gray-900">
      <div className="mx-auto max-w-6xl">
        <AppNav />

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
            <div className="mt-3 flex flex-wrap gap-2">
              {INDEX_INSTRUMENTS.map((item) => (
                <Link
                  key={item.id}
                  to={`/option-chain/${item.id.toLowerCase()}`}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                    item.id === instrument.id
                      ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  }`}
                >
                  {item.name}
                </Link>
              ))}
            </div>
          </div>

          {chain ? (
            <ExpirySelect
              expiries={chain.expiries}
              selected={chain.expiry}
              action={action}
            />
          ) : null}
        </header>

        {error ? (
          <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
            {error}
          </div>
        ) : null}

        {chain ? (
          <OptionChainTable rows={chain.rows} spot={chain.spot} />
        ) : !error ? (
          <p className="text-slate-500">Loading option chain…</p>
        ) : null}
      </div>
    </main>
  );
}
