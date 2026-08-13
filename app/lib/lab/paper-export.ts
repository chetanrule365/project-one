import {
  listAllTradesWithInstrument,
  type PaperTradeExportRow,
} from "./paper-store";

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function stringCell(value: string | number | null | undefined) {
  const text = value == null ? "" : String(value);
  return `<Cell><Data ss:Type="String">${escapeXml(text)}</Data></Cell>`;
}

function numberCell(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) {
    return `<Cell><Data ss:Type="String"></Data></Cell>`;
  }
  return `<Cell><Data ss:Type="Number">${value}</Data></Cell>`;
}

const HEADERS = [
  "Trade ID",
  "Run ID",
  "Index",
  "Run strategy",
  "Path",
  "Status",
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
  "Exit at",
  "Run status",
  "Wing width",
] as const;

export function paperTradesExportFilename(day = new Date()) {
  const stamp = day.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return `paper-trades-${stamp}.xls`;
}

/** Excel SpreadsheetML workbook — opens in Excel, Sheets, and LibreOffice. */
export function buildPaperTradesWorkbook(
  trades: PaperTradeExportRow[] = listAllTradesWithInstrument(),
) {
  const header = `<Row>${HEADERS.map((h) => stringCell(h)).join("")}</Row>`;
  const rows = trades.map((trade) => {
    const cells = [
      numberCell(trade.id),
      numberCell(trade.run_id),
      stringCell(trade.instrument_id),
      stringCell(trade.run_strategy_id),
      stringCell(trade.strategy_id),
      stringCell(trade.status),
      numberCell(trade.short_strike),
      numberCell(trade.long_strike),
      stringCell(trade.short_side),
      stringCell(trade.long_side),
      numberCell(trade.credit),
      numberCell(trade.width),
      numberCell(trade.spot_entry),
      numberCell(trade.spot_exit),
      numberCell(trade.pnl_points),
      numberCell(trade.pnl_inr),
      stringCell(trade.entry_at),
      stringCell(trade.expiry_at),
      stringCell(trade.exit_at),
      stringCell(trade.run_status),
      numberCell(trade.width_steps),
    ];
    return `<Row>${cells.join("")}</Row>`;
  });

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Paper trades">
  <Table>
${header}
${rows.join("\n")}
  </Table>
 </Worksheet>
</Workbook>
`;
}
