import { Link } from "react-router";
import type { Route } from "./+types/$";

/** Chrome / Cursor probes hit /json/version on the app port — answer quietly. */
function isProbe(pathname: string) {
  return (
    pathname.startsWith("/json/") ||
    pathname === "/favicon.ico" ||
    pathname === "/.well-known/appspecific/com.chrome.devtools.json"
  );
}

export async function loader({ request }: Route.LoaderArgs) {
  const { pathname } = new URL(request.url);
  if (isProbe(pathname)) {
    return new Response(null, { status: 404 });
  }
  throw new Response("Not Found", { status: 404, statusText: "Not Found" });
}

export default function NotFound() {
  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
        Page not found
      </h1>
      <p className="mt-2 text-sm text-slate-500">
        That URL is not part of Project One.
      </p>
      <Link
        to="/"
        className="mt-6 inline-block text-sm font-medium text-sky-700 underline-offset-2 hover:underline dark:text-sky-300"
      >
        Back home
      </Link>
    </main>
  );
}
