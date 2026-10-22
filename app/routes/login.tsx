import { Form, redirect, useNavigation, useSearchParams } from "react-router";
import type { Route } from "./+types/login";
import { clearLoginCooldown, clearToken, generateViaTotp } from "../lib/dhan/auth.server";
import {
  clearPin,
  hasPin,
  hydratePinFromRequest,
  isValidPin,
  pinClearCookie,
  pinSetCookie,
  setPin,
} from "../lib/dhan/pin.server";
import { demoClearCookie } from "../lib/demo.server";
import { bootCloudStores } from "../lib/store/boot.server";
import { safeNextPath } from "../lib/next-path";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Unlock · Project One" },
    { name: "description", content: "Enter your Dhan PIN to unlock the lab" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  await bootCloudStores();
  hydratePinFromRequest(request);
  if (!hasPin()) return { error: null };
  const next = safeNextPath(new URL(request.url).searchParams.get("next"));
  throw redirect(next);
}

export async function action({ request }: Route.ActionArgs) {
  await bootCloudStores();
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "login");
  const next = safeNextPath(String(form.get("next") ?? "/"));

  if (intent === "logout") {
    clearPin();
    clearToken();
    const headers = new Headers();
    headers.append("Set-Cookie", pinClearCookie(request));
    headers.append("Set-Cookie", demoClearCookie(request));
    return redirect("/login", { headers });
  }

  const pin = String(form.get("pin") ?? "").replace(/\s+/g, "");
  if (!isValidPin(pin)) {
    return { error: "Enter your 4–8 digit Dhan PIN." };
  }

  setPin(pin);
  try {
    clearLoginCooldown();
    await generateViaTotp({ fromLogin: true });
  } catch (error) {
    clearPin();
    return {
      error:
        error instanceof Error
          ? error.message
          : "Could not unlock with that PIN.",
    };
  }
  const headers = new Headers();
  headers.append("Set-Cookie", pinSetCookie(pin, request));
  headers.append("Set-Cookie", demoClearCookie(request));
  throw redirect(next, { headers });
}

export default function LoginPage({ actionData }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const next = safeNextPath(params.get("next"));
  const error = actionData?.error ?? null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-50 via-white to-slate-100 px-4 py-10 dark:from-gray-950 dark:via-gray-950 dark:to-gray-900">
      <div className="w-full max-w-sm">
        <p className="text-center text-sm font-semibold tracking-tight text-slate-900 dark:text-white">
          Project One
        </p>
        <p className="mt-1 text-center text-[11px] text-slate-500">Index lab</p>

        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 dark:border-slate-800 dark:bg-slate-900/70">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
            Enter PIN
          </h1>
          <p className="mt-1.5 text-sm leading-snug text-slate-500 dark:text-slate-400">
            Unlock with the Dhan PIN used for TOTP auto-login. It is encrypted
            into a browser cookie — not env, not a JSON file.
          </p>

          {error ? (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
              {error}
            </div>
          ) : null}

          <Form method="post" className="mt-5 space-y-4">
            <input type="hidden" name="intent" value="login" />
            <input type="hidden" name="next" value={next} />
            <label className="block">
              <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                Dhan PIN
              </span>
              <input
                type="password"
                name="pin"
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                required
                minLength={4}
                maxLength={8}
                pattern="\d{4,8}"
                disabled={busy}
                className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base tracking-[0.35em] text-slate-900 tabular-nums outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-slate-100 dark:focus:ring-white/10"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
            >
              {busy ? "Unlocking…" : "Unlock"}
            </button>
          </Form>

          <a
            href="/demo"
            className="mt-4 block text-center text-sm font-medium text-slate-600 underline-offset-2 hover:underline dark:text-slate-300"
          >
            View a sample walkthrough
          </a>
        </section>
      </div>
    </main>
  );
}
