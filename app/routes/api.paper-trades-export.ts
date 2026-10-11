import type { Route } from "./+types/api.paper-trades-export";
import { bootSession } from "../lib/session.server";
import { pullPaperStore } from "../lib/lab/paper-store";
import {
  buildPaperTradesCsv,
  paperTradesExportFilename,
} from "../lib/lab/paper-export";

export async function loader({ request }: Route.LoaderArgs) {
  await bootSession(request, "api");
  await pullPaperStore();
  const body = buildPaperTradesCsv();
  const filename = paperTradesExportFilename();
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
