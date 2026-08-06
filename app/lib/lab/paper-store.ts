import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { getDataDir, getPaperDbPath } from "../data-dir";

export type PaperRun = {
  id: number;
  instrument_id: string;
  strategy_id: string;
  width_steps: number;
  status: "active" | "stopped";
  created_at: string;
  updated_at: string;
};

export type PaperTrade = {
  id: number;
  run_id: number;
  strategy_id: string;
  status: "open" | "closed";
  short_strike: number;
  long_strike: number;
  short_side: string;
  long_side: string;
  credit: number;
  width: number;
  spot_entry: number;
  spot_exit: number | null;
  pnl_points: number | null;
  pnl_inr: number | null;
  entry_at: string;
  expiry_at: string;
  exit_at: string | null;
};

function dbPath() {
  mkdirSync(getDataDir(), { recursive: true });
  return getPaperDbPath();
}

let dbSingleton: Database.Database | null = null;

export function getPaperDb() {
  if (!dbSingleton) {
    const file = dbPath();
    try {
      const db = new Database(file);
      // DELETE is safer than WAL on some mounted volumes (e.g. Railway).
      db.pragma("journal_mode = DELETE");
      dbSingleton = db;
    } catch (error) {
      console.error(`[paper-store] failed to open ${file}`, error);
      throw error;
    }
    dbSingleton.exec(`
      CREATE TABLE IF NOT EXISTS paper_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instrument_id TEXT NOT NULL,
        strategy_id TEXT NOT NULL,
        width_steps INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS paper_trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL,
        strategy_id TEXT NOT NULL,
        status TEXT NOT NULL,
        short_strike REAL NOT NULL,
        long_strike REAL NOT NULL,
        short_side TEXT NOT NULL,
        long_side TEXT NOT NULL,
        credit REAL NOT NULL,
        width REAL NOT NULL,
        spot_entry REAL NOT NULL,
        spot_exit REAL,
        pnl_points REAL,
        pnl_inr REAL,
        entry_at TEXT NOT NULL,
        expiry_at TEXT NOT NULL,
        exit_at TEXT,
        FOREIGN KEY(run_id) REFERENCES paper_runs(id)
      );
    `);
  }
  return dbSingleton;
}

export function listPaperRuns() {
  return getPaperDb()
    .prepare(
      `SELECT * FROM paper_runs ORDER BY id DESC LIMIT 20`,
    )
    .all() as PaperRun[];
}

export function getActiveRun() {
  return getPaperDb()
    .prepare(`SELECT * FROM paper_runs WHERE status = 'active' ORDER BY id DESC LIMIT 1`)
    .get() as PaperRun | undefined;
}

export function startPaperRun(input: {
  instrumentId: string;
  strategyId: string;
  widthSteps: number;
}) {
  const db = getPaperDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE paper_runs SET status = 'stopped', updated_at = ? WHERE status = 'active'`,
  ).run(now);

  const result = db
    .prepare(
      `INSERT INTO paper_runs (instrument_id, strategy_id, width_steps, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?)`,
    )
    .run(
      input.instrumentId,
      input.strategyId,
      input.widthSteps,
      now,
      now,
    );

  return getPaperDb()
    .prepare(`SELECT * FROM paper_runs WHERE id = ?`)
    .get(result.lastInsertRowid) as PaperRun;
}

export function stopPaperRun(runId: number) {
  getPaperDb()
    .prepare(
      `UPDATE paper_runs SET status = 'stopped', updated_at = ? WHERE id = ?`,
    )
    .run(new Date().toISOString(), runId);
}

export function listTradesForRun(runId: number) {
  return getPaperDb()
    .prepare(
      `SELECT * FROM paper_trades WHERE run_id = ? ORDER BY id DESC`,
    )
    .all(runId) as PaperTrade[];
}

export function getOpenTrade(runId: number) {
  return getPaperDb()
    .prepare(
      `SELECT * FROM paper_trades WHERE run_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1`,
    )
    .get(runId) as PaperTrade | undefined;
}

export function insertOpenTrade(trade: Omit<PaperTrade, "id" | "spot_exit" | "pnl_points" | "pnl_inr" | "exit_at" | "status">) {
  const result = getPaperDb()
    .prepare(
      `INSERT INTO paper_trades (
        run_id, strategy_id, status, short_strike, long_strike, short_side, long_side,
        credit, width, spot_entry, spot_exit, pnl_points, pnl_inr, entry_at, expiry_at, exit_at
      ) VALUES (?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, NULL)`,
    )
    .run(
      trade.run_id,
      trade.strategy_id,
      trade.short_strike,
      trade.long_strike,
      trade.short_side,
      trade.long_side,
      trade.credit,
      trade.width,
      trade.spot_entry,
      trade.entry_at,
      trade.expiry_at,
    );

  return getPaperDb()
    .prepare(`SELECT * FROM paper_trades WHERE id = ?`)
    .get(result.lastInsertRowid) as PaperTrade;
}

export function closeTrade(
  tradeId: number,
  input: { spotExit: number; pnlPoints: number; pnlInr: number },
) {
  getPaperDb()
    .prepare(
      `UPDATE paper_trades
       SET status = 'closed', spot_exit = ?, pnl_points = ?, pnl_inr = ?, exit_at = ?
       WHERE id = ?`,
    )
    .run(
      input.spotExit,
      input.pnlPoints,
      input.pnlInr,
      new Date().toISOString(),
      tradeId,
    );
}
