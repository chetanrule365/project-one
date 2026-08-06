import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/home";
import { IndexCard } from "../components/IndexCard";
import type { FeedStatus, IndexQuote } from "../lib/dhan/instruments";
import { INDEX_INSTRUMENTS } from "../lib/dhan/instruments";
import {
  DhanApiError,
  DhanConfigError,
  fetchIndexQuotes,
  isDhanSandbox,
} from "../lib/dhan/quotes";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Market Watch" },
    {
      name: "description",
      content: "Live Nifty, Bank Nifty, and Sensex prices via Dhan",
    },
  ];
}

export async function loader() {
  const sandbox = isDhanSandbox();

  try {
    const quotes = await fetchIndexQuotes();
    return {
      quotes,
      sandbox,
      error: null as string | null,
    };
  } catch (error) {
    const message =
      error instanceof DhanConfigError || error instanceof DhanApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Failed to load index quotes";

    return {
      quotes: [] as IndexQuote[],
      sandbox,
      error: message,
    };
  }
}

type LiveSnapshot = {
  status: FeedStatus;
  error: string | null;
  mode?: "websocket" | "polling";
  quotes: Record<string, IndexQuote>;
};

function mergeQuotes(
  base: IndexQuote[],
  live: Record<string, IndexQuote>,
): IndexQuote[] {
  if (Object.keys(live).length === 0) return base;

  const byId = new Map(base.map((quote) => [quote.id, quote]));
  for (const quote of Object.values(live)) {
    byId.set(quote.id, quote);
  }

  return INDEX_INSTRUMENTS.map((instrument) => byId.get(instrument.id)).filter(
    (quote): quote is IndexQuote => Boolean(quote),
  );
}

function statusLabel(status: FeedStatus, sandbox: boolean) {
  if (sandbox && status === "connected") return "Sandbox";
  switch (status) {
    case "connected":
      return "Live";
    case "connecting":
      return "Connecting";
    case "error":
      return "Error";
    default:
      return "Offline";
  }
}

function statusTone(status: FeedStatus) {
  switch (status) {
    case "connected":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
    case "connecting":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
    case "error":
      return "bg-rose-500/15 text-rose-700 dark:text-rose-300";
    default:
      return "bg-gray-500/15 text-gray-700 dark:text-gray-300";
  }
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const [quotes, setQuotes] = useState(loaderData.quotes);
  const [feedStatus, setFeedStatus] = useState<FeedStatus>("connecting");
  const [feedError, setFeedError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(
    loaderData.quotes[0]?.updatedAt ?? null,
  );

  useEffect(() => {
    setQuotes(loaderData.quotes);
  }, [loaderData.quotes]);

  useEffect(() => {
    const source = new EventSource("/api/market-feed");

    source.addEventListener("quotes", (event) => {
      try {
        const snapshot = JSON.parse(
          (event as MessageEvent).data,
        ) as LiveSnapshot;
        setFeedStatus(snapshot.status);
        setFeedError(snapshot.error);
        setQuotes((current) => {
          const next = mergeQuotes(current, snapshot.quotes);
          const latest = next
            .map((quote) => quote.updatedAt)
            .sort()
            .at(-1);
          if (latest) setUpdatedAt(latest);
          return next;
        });
      } catch {
        setFeedError("Failed to parse live market update");
      }
    });

    source.onerror = () => {
      setFeedStatus("error");
      setFeedError("Live feed connection lost — retrying…");
    };

    return () => {
      source.close();
    };
  }, []);

  const displayError = loaderData.error || feedError;

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100 px-4 py-10 dark:from-gray-950 dark:via-gray-950 dark:to-gray-900">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium tracking-wide text-slate-500 uppercase">
              India Indices
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
              Market Watch
            </h1>
            <p className="mt-2">
              <Link
                to="/lab"
                className="text-sm font-medium text-slate-600 underline-offset-2 hover:underline dark:text-slate-300"
              >
                Strategy Lab →
              </Link>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 font-medium ${statusTone(feedStatus)}`}
            >
              {statusLabel(feedStatus, loaderData.sandbox)}
            </span>
            {updatedAt ? (
              <span className="text-slate-500 dark:text-slate-400">
                Updated{" "}
                {new Date(updatedAt).toLocaleTimeString("en-IN", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
            ) : null}
          </div>
        </header>

        {loaderData.sandbox ? (
          <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
            Using Dhan sandbox — chart snapshots (mock data), polled every 15s.
            Live WebSocket requires production API + Data plan.
          </p>
        ) : null}

        {displayError ? (
          <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
            {displayError}
          </div>
        ) : null}

        {quotes.length > 0 ? (
          <section className="grid gap-4 md:grid-cols-3">
            {quotes.map((quote) => (
              <IndexCard key={quote.id} quote={quote} />
            ))}
          </section>
        ) : (
          <p className="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-slate-500 dark:border-slate-700 dark:text-slate-400">
            No index quotes yet. Check your Dhan credentials and try again.
          </p>
        )}
      </div>
    </main>
  );
}
