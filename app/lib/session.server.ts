import { redirect } from "react-router";
import { hasPin, hydratePinFromRequest } from "./dhan/pin";
import { bootCloudStores } from "./store/boot";
import { safeNextPath } from "./next-path";

export async function bootSession(
  request: Request,
  kind: "page" | "api" = "page",
) {
  await bootCloudStores();
  hydratePinFromRequest(request);
  if (hasPin()) return;
  if (kind === "api") {
    throw new Response(JSON.stringify({ error: "PIN required" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const url = new URL(request.url);
  const next = safeNextPath(url.pathname + url.search);
  throw redirect(`/login?next=${encodeURIComponent(next)}`);
}
