import {
  buildPaperTradesCsv,
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
  pnl_points: -0.700000000000017,
  pnl_inr: -21.00000000000051,
  entry_at: "2026-08-13",
  expiry_at: "2026-08-13",
  exit_at: "2026-08-13T08:30:00.000Z",
  instrument_id: "SENSEX",
  run_strategy_id: "AUTO",
  run_status: "active",
  width_steps: 2,
};

const csv = buildPaperTradesCsv([
  { ...sample, strategy_id: "A & B <test>, quoted" },
]);

const lines = csv.trimEnd().split("\r\n");
const header = lines[0] ?? "";
const row = lines[1] ?? "";

const checks = [
  header.startsWith("Trade ID,Run ID,Index,"),
  header.includes("P&L INR"),
  row.includes('"A & B <test>, quoted"'),
  row.includes(",-0.7,-21,"),
  paperTradesExportFilename(new Date("2026-08-13T06:00:00Z")) ===
    "paper-trades-2026-08-13.csv",
  csv.endsWith("\r\n"),
];

if (checks.some((ok) => !ok)) {
  console.error("paper-export checks failed", { checks, header, row });
  process.exit(1);
}

console.log("paper-export ok");
