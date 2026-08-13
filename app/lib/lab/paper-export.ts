import { listAllTradesWithInstrument, type PaperTradeExportRow } from "./paper-store";
import { formatIstTimestamp, formatPaperLegs } from "./paper-position";
import { buildXlsxWorkbook } from "./xlsx-workbook";

const HEADERS = [
  "Trade ID",
  "Run ID",
  "Index",
  "Run strategy",
  "Path",
  "Status",
  "Legs",
  "Short strike",
  "Long strike",
  "Short side",
  "Long side",
  "Credit",
  "Width",
  "Spot entry",
  "Spot exit",
  "P&L points",
  "P&L INR",
  "Entry date",
  "Expiry",
  "Exit at (IST)",
  "Run status",
  "Wing width",
] as const;

export function paperTradesExportFilename(day = new Date()) {
  const stamp = day.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return `paper-trades-${stamp}.xlsx`;
}

function tradeRow(trade: PaperTradeExportRow) {
  const hasShort = trade.short_strike > 0;
  return [
    trade.id,
    trade.run_id,
    trade.instrument_id,
    trade.run_strategy_id,
    trade.strategy_id,
    trade.status,
    formatPaperLegs(trade),
    hasShort ? trade.short_strike : "",
    trade.long_strike > 0 ? trade.long_strike : "",
    hasShort ? trade.short_side : "",
    trade.long_strike > 0 ? trade.long_side : "",
    trade.credit,
    trade.width > 0 ? trade.width : "",
    trade.spot_entry,
    trade.spot_exit,
    trade.pnl_points,
    trade.pnl_inr,
    trade.entry_at,
    trade.expiry_at,
    formatIstTimestamp(trade.exit_at),
    trade.run_status,
    trade.width_steps,
  ];
}

/** Real Office Open XML .xlsx workbook. */
export function buildPaperTradesWorkbook(
  trades: PaperTradeExportRow[] = listAllTradesWithInstrument(),
) {
  return buildXlsxWorkbook(
    "Paper trades",
    [[...HEADERS], ...trades.map(tradeRow)],
    { defaultColWidth: 14, dateColIndexes: [6, 17, 18, 19] },
  );
}
