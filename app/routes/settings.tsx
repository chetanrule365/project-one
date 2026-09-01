import { Form, redirect, useNavigation, useSearchParams } from "react-router";
import type { Route } from "./+types/settings";
import { clearToken, generateViaTotp, getAuthStatus } from "../lib/dhan/auth";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Settings · Dhan token" },
    {
      name: "description",
      content: "Manage the Dhan access token with TOTP auto-login",
    },
  ];
}

export async function loader() {
  return { status: getAuthStatus() };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  try {
    switch (intent) {
      case "totp": {
        await generateViaTotp();
        return redirect("/settings?connected=totp");
      }
      case "disconnect": {
        clearToken();
        return redirect("/settings?disconnected=1");
      }
      default:
        return { error: "Unknown action." };
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Something went wrong.",
    };
  }
}

const SOURCE_LABEL: Record<string, string> = {
  totp: "TOTP auto-login",
  env: "Environment variable",
};

function StatusBadge({ connected, expired }: { connected: boolean; expired: boolean }) {
  const tone = expired
    ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
    : connected
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
      : "bg-rose-500/15 text-rose-700 dark:text-rose-300";
  const label = expired ? "Token expired" : connected ? "Connected" : "Not connected";
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${tone}`}>
      {label}
    </span>
  );
}

export default function SettingsPage({ loaderData, actionData }: Route.ComponentProps) {
  const { status } = loaderData;
  const [params] = useSearchParams();
  const navigation = useNavigation();
  const busyIntent =
    navigation.state !== "idle"
      ? String(navigation.formData?.get("intent") ?? "")
      : "";

  const connectedFlash = params.get("connected");
  const disconnectedFlash = params.get("disconnected");
  const errorFlash = params.get("error") ?? actionData?.error ?? null;

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100 px-3 py-4 sm:px-4 sm:py-8 dark:from-gray-950 dark:via-gray-950 dark:to-gray-900">
      <div className="mx-auto max-w-3xl">
        <header className="mb-4 sm:mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl dark:text-white">
            Settings
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-snug text-slate-500 dark:text-slate-400">
            Dhan access tokens expire every 24 hours. With TOTP auto-login the
            app mints and refreshes the token for you — no daily copy-paste.
          </p>
        </header>

        {errorFlash ? (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
            {errorFlash}
          </div>
        ) : null}
        {connectedFlash ? (
          <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200">
            Connected via {SOURCE_LABEL[connectedFlash] ?? connectedFlash}. Your
            token is stored and will be used automatically.
          </div>
        ) : null}
        {disconnectedFlash ? (
          <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
            Stored token cleared.
          </div>
        ) : null}

        <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900/70">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                Connection status
              </p>
              <div className="mt-1.5 flex items-center gap-3">
                <StatusBadge connected={status.connected} expired={status.expired} />
                {status.source ? (
                  <span className="text-sm text-slate-500 dark:text-slate-400">
                    {SOURCE_LABEL[status.source] ?? status.source}
                  </span>
                ) : null}
              </div>
            </div>
            {status.connected ? (
              <Form method="post">
                <input type="hidden" name="intent" value="disconnect" />
                <button
                  type="submit"
                  disabled={busyIntent === "disconnect"}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  {busyIntent === "disconnect" ? "Clearing…" : "Disconnect"}
                </button>
              </Form>
            ) : null}
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-[11px] tracking-wide text-slate-400 uppercase">Client ID</dt>
              <dd className="text-slate-700 tabular-nums dark:text-slate-200">
                {status.clientId ?? "—"}
              </dd>
            </div>
            {status.clientName ? (
              <div>
                <dt className="text-[11px] tracking-wide text-slate-400 uppercase">Name</dt>
                <dd className="text-slate-700 dark:text-slate-200">{status.clientName}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-[11px] tracking-wide text-slate-400 uppercase">Expires in</dt>
              <dd className="text-slate-700 tabular-nums dark:text-slate-200">
                {status.minutesLeft == null
                  ? "—"
                  : status.minutesLeft <= 0
                    ? "expired"
                    : `${status.minutesLeft} min`}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900/70">
          <div className="mb-1 flex items-center gap-2">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Automatic (TOTP)
            </h2>
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-700 uppercase dark:text-emerald-300">
              Recommended
            </span>
          </div>
          <p className="mb-3 text-sm leading-snug text-slate-500 dark:text-slate-400">
            Set DHAN_CLIENT_ID, DHAN_PIN, and DHAN_TOTP_SECRET once (enable TOTP
            on web.dhan.co → DhanHQ Trading APIs → Setup TOTP). The server then
            mints and refreshes the token itself — no daily action.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Form method="post">
              <input type="hidden" name="intent" value="totp" />
              <button
                type="submit"
                disabled={!status.totpReady || busyIntent === "totp"}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
              >
                {busyIntent === "totp" ? "Generating…" : "Generate token now"}
              </button>
            </Form>
            <span
              className={`text-xs font-medium ${status.totpReady ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"}`}
            >
              {status.totpReady
                ? "TOTP credentials detected"
                : "Set DHAN_PIN + DHAN_TOTP_SECRET to enable"}
            </span>
          </div>
        </section>
      </div>
    </main>
  );
}
