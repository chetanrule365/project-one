import type { Route } from "./+types/api.paper-trades-export";
import {
  buildPaperTradesWorkbook,
  paperTradesExportFilename,
} from "../lib/lab/paper-export";

export async function loader({}: Route.LoaderArgs) {
  const body = buildPaperTradesWorkbook();
  const filename = paperTradesExportFilename();
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
