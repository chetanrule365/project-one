import type { Route } from "./+types/api.paper-trades-export";
import { isDemoRequest } from "../lib/demo.server";
import { demoPaperCsv } from "../lib/lab/demo-data.server";
import { bootSession } from "../lib/session.server";
import { pullPaperStore } from "../lib/lab/paper-store.server";
import {
  buildPaperTradesCsv,
  paperTradesExportFilename,
} from "../lib/lab/paper-export.server";

export async function loader({ request }: Route.LoaderArgs) {
  await bootSession(request, "api");
  if (isDemoRequest(request)) {
    return new Response(demoPaperCsv(), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="project-one-demo-paper.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }
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
