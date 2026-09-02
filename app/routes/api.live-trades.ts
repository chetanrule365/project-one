import { getLivePaperTrades } from "../lib/lab/paper";
import { ensurePaperWorker } from "../lib/lab/paper-worker";

/**
 * Lightweight JSON feed of open paper trades + their live P&L. Reads only the
 * local store (no Dhan calls), so the home page can poll it cheaply. The marks
 * themselves are refreshed by the paper worker on its sync cadence.
 */
export async function loader() {
  ensurePaperWorker();
  return Response.json(getLivePaperTrades());
}
