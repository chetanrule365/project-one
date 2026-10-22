import type { Route } from "./+types/api.live-trades";
import { isCloudBacktestClient, keepCloudAwake } from "../lib/lab/backtest-cloud";
import { getLivePaperTrades } from "../lib/lab/paper.server";
import { ensurePaperWorker } from "../lib/lab/paper-worker.server";
import { pullPaperStore } from "../lib/lab/paper-store.server";
import { isDemoRequest } from "../lib/demo.server";
import { demoLivePaperTrades } from "../lib/lab/demo-data.server";
import { bootSession } from "../lib/session.server";

/**
 * Lightweight JSON feed of open paper trades + their live P&L. Reads only the
 * local store (no Dhan calls), so the home page can poll it cheaply. The marks
 * themselves are refreshed by the paper worker on its sync cadence.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await bootSession(request, "api");
  if (isDemoRequest(request)) {
    return Response.json(demoLivePaperTrades());
  }
  await pullPaperStore();
  if (isCloudBacktestClient()) void keepCloudAwake();
  ensurePaperWorker();
  return Response.json(getLivePaperTrades());
}
