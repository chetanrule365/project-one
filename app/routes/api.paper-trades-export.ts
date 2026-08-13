import type { Route } from "./+types/api.paper-trades-export";
import {
  buildPaperTradesWorkbook,
  paperTradesExportFilename,
} from "../lib/lab/paper-export";

export async function loader({}: Route.LoaderArgs) {
  const body = buildPaperTradesWorkbook();
  const filename = paperTradesExportFilename();
  return new Response(body, {
    headers: {
      "Content-Type": "application/vnd.ms-excel; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
