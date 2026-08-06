import path from "node:path";

/** Root for SQLite + rolling cache. Override with DATA_DIR=/data on Railway. */
export function getDataDir() {
  const configured = process.env.DATA_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.join(process.cwd(), "data");
}

export function getPaperDbPath() {
  return path.join(getDataDir(), "paper.db");
}

export function getCacheDir() {
  return path.join(getDataDir(), "cache");
}
