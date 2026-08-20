import { listAllTradesWithInstrument, type PaperTradeExportRow } from "./paper-store";
import {
  formatIstTimestamp,
  formatPaperLegPrices,
  formatPaperLegs,
} from "./paper-position";

const HEADERS = [
  "Trade ID",
  "Run ID",
  "Index",
  "Run strategy",
  "Path",
  "Status",
  "Legs",
  "Entry leg prices",
  "Exit leg prices",
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
  "Expiry session",
  "Exit at (IST)",
  "Run status",
  "Wing width",
  "Margin",
] as const;

export function paperTradesExportFilename(day = new Date()) {
  const stamp = day.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return `paper-trades-${stamp}.csv`;
}

function csvField(value: string | number | null | undefined) {
  if (value == null) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.round(value * 100) / 100);
  }
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
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
    formatPaperLegPrices(trade.legs),
    formatPaperLegPrices(trade.exit_legs),
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
    trade.expiry_session === true ? "true" : "false",
    formatIstTimestamp(trade.exit_at),
    trade.run_status,
    trade.width_steps,
    trade.margin_inr,
  ];
}

/** UTF-8 CSV of all paper trades. */
export function buildPaperTradesCsv(
  trades: PaperTradeExportRow[] = listAllTradesWithInstrument(),
) {
  const rows = [[...HEADERS], ...trades.map(tradeRow)];
  return rows.map((row) => row.map(csvField).join(",")).join("\r\n") + "\r\n";
}
