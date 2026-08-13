import { inflateRawSync } from "node:zlib";
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

const xlsx = buildPaperTradesWorkbook([
  { ...sample, strategy_id: "A & B <test>" },
]);

function zipEntries(buf: Buffer) {
  const names: string[] = [];
  let i = 0;
  while (i + 4 <= buf.length) {
    const sig = buf.readUInt32LE(i);
    if (sig !== 0x04034b50) break;
    const method = buf.readUInt16LE(i + 8);
    const compSize = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nameLen).toString("utf8");
    names.push(name);
    const dataStart = i + 30 + nameLen + extraLen;
    const data = buf.subarray(dataStart, dataStart + compSize);
    if (name === "xl/sharedStrings.xml") {
      const xml =
        method === 8
          ? inflateRawSync(data).toString("utf8")
          : data.toString("utf8");
      if (!xml.includes("A &amp; B &lt;test&gt;")) {
        throw new Error("shared strings missing escaped path");
      }
      if (xml.includes("A & B <test>")) {
        throw new Error("shared strings not escaped");
      }
    }
    i = dataStart + compSize;
  }
  return names;
}

const names = zipEntries(xlsx);
const needed = [
  "[Content_Types].xml",
  "xl/workbook.xml",
  "xl/worksheets/sheet1.xml",
  "xl/sharedStrings.xml",
];

const checks = [
  xlsx.subarray(0, 2).toString() === "PK",
  needed.every((name) => names.includes(name)),
  paperTradesExportFilename(new Date("2026-08-13T06:00:00Z")) ===
    "paper-trades-2026-08-13.xlsx",
];

if (checks.some((ok) => !ok)) {
  console.error("paper-export checks failed", { checks, names });
  process.exit(1);
}

console.log("paper-export ok");
