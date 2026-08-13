import {
  buildPaperTradesWorkbook,
  paperTradesExportFilename,
} from "../app/lib/lab/paper-export";
import type { PaperTradeExportRow } from "../app/lib/lab/paper-store";

const sample: PaperTradeExportRow = {
  id: 1,
  run_id: 2,
  strategy_id: "IRON_CONDOR",
  status: "closed",
  short_strike: 81500,
  long_strike: 81700,
  short_side: "CE",
  long_side: "CE",
  credit: 42.5,
  width: 200,
  spot_entry: 81480,
  spot_exit: 81510,
  pnl_points: 12.5,
  pnl_inr: 250,
  entry_at: "2026-08-13",
  expiry_at: "2026-08-13",
  exit_at: "2026-08-13T08:30:00.000Z",
  instrument_id: "SENSEX",
  run_strategy_id: "AUTO",
  run_status: "active",
  width_steps: 2,
};

const xml = buildPaperTradesWorkbook([
  { ...sample, strategy_id: 'A & B <test>' },
]);

const checks = [
  xml.includes("<?mso-application progid=\"Excel.Sheet\"?>"),
  xml.includes("SENSEX"),
  xml.includes("A &amp; B &lt;test&gt;"),
  !xml.includes("A & B <test>"),
  xml.includes("ss:Type=\"Number\">42.5<"),
  xml.includes("Paper trades"),
  paperTradesExportFilename(new Date("2026-08-13T06:00:00Z")) ===
    "paper-trades-2026-08-13.xls",
];

if (checks.some((ok) => !ok)) {
  console.error("paper-export checks failed", checks);
  process.exit(1);
}

console.log("paper-export ok");
