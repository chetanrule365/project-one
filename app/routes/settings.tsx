import { Form, redirect, useNavigation, useSearchParams } from "react-router";
import type { Route } from "./+types/settings";
import {
  clearToken,
  generateConsent,
  generateViaTotp,
  getAuthStatus,
  setManualToken,
} from "../lib/dhan/auth";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Settings · Dhan login" },
    {
      name: "description",
      content: "Connect your Dhan account and manage the access token",
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
      case "login": {
        const { loginUrl } = await generateConsent();
        return redirect(loginUrl);
      }
      case "totp": {
        await generateViaTotp();
        return redirect("/settings?connected=totp");
      }
      case "manual": {
        const token = String(form.get("accessToken") ?? "");
        const clientId = String(form.get("clientId") ?? "");
        setManualToken(token, clientId || undefined);
        return redirect("/settings?connected=manual");
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
  oauth: "Dhan login",
  manual: "Manual token",
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

function Card({
  title,
  description,
  children,
  recommended,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  recommended?: boolean;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900/70">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          {title}
        </h2>
        {recommended ? (
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-700 uppercase dark:text-emerald-300">
            Recommended
          </span>
        ) : null}
      </div>
      <p className="mb-3 text-sm leading-snug text-slate-500 dark:text-slate-400">
        {description}
      </p>
      {children}
    </section>
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
            Connect your Dhan account. Access tokens expire every 24 hours —
            use TOTP auto-login so the app refreshes the token for you, no
            daily copy-paste.
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

        <div className="space-y-4">
          <Card
            title="Automatic (TOTP)"
            description="Set DHAN_CLIENT_ID, DHAN_PIN, and DHAN_TOTP_SECRET once (enable TOTP on web.dhan.co → DhanHQ Trading APIs → Setup TOTP). The server then mints and refreshes the token itself — no daily action."
            recommended
          >
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
          </Card>

          <Card
            title="Login with Dhan"
            description="One-click browser login using your API key & secret (DHAN_APP_ID, DHAN_APP_SECRET from web.dhan.co). The token is stored server-side — no copy-paste. Set the API key's Redirect URL to this app's /settings/dhan-callback."
          >
            <div className="flex flex-wrap items-center gap-3">
              <Form method="post">
                <input type="hidden" name="intent" value="login" />
                <button
                  type="submit"
                  disabled={!status.oauthReady || busyIntent === "login"}
                  className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
                >
                  {busyIntent === "login" ? "Redirecting…" : "Login with Dhan"}
                </button>
              </Form>
              <span
                className={`text-xs font-medium ${status.oauthReady ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"}`}
              >
                {status.oauthReady
                  ? "API key & secret detected"
                  : "Set DHAN_APP_ID + DHAN_APP_SECRET to enable"}
              </span>
            </div>
          </Card>

          <Card
            title="Manual token"
            description="Paste an access token generated from web.dhan.co. It is stored on the server (persisted to the data volume), so it survives restarts — you no longer need to edit the environment."
          >
            <Form method="post" className="space-y-3">
              <input type="hidden" name="intent" value="manual" />
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium tracking-wide text-slate-500 uppercase">
                  Access token
                </span>
                <input
                  type="password"
                  name="accessToken"
                  required
                  autoComplete="off"
                  placeholder="eyJ..."
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium tracking-wide text-slate-500 uppercase">
                  Client ID (optional — defaults to DHAN_CLIENT_ID)
                </span>
                <input
                  type="text"
                  name="clientId"
                  autoComplete="off"
                  placeholder={status.clientId ?? "1000000001"}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </label>
              <button
                type="submit"
                disabled={busyIntent === "manual"}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {busyIntent === "manual" ? "Saving…" : "Save token"}
              </button>
            </Form>
          </Card>
        </div>
      </div>
    </main>
  );
}
