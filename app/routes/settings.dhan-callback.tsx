import { redirect } from "react-router";
import type { Route } from "./+types/settings.dhan-callback";
import { consumeConsent } from "../lib/dhan/auth";

/**
 * Redirect target for the Dhan OAuth login. Dhan appends `?tokenId=...`; we
 * exchange it for an access token and bounce back to the Settings page.
 *
 * Configure this exact URL as the Redirect URL when creating your API key on
 * web.dhan.co, e.g. https://your-app.up.railway.app/settings/dhan-callback
 */
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const tokenId = url.searchParams.get("tokenId");

  if (!tokenId) {
    return redirect("/settings?error=" + encodeURIComponent("Login was cancelled or no token was returned."));
  }

  try {
    await consumeConsent(tokenId);
    return redirect("/settings?connected=oauth");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to complete Dhan login.";
    return redirect("/settings?error=" + encodeURIComponent(message));
  }
}

export default function DhanCallback() {
  return (
    <main className="min-h-screen px-4 py-10">
      <p className="text-sm text-slate-500">Completing Dhan login…</p>
    </main>
  );
}
