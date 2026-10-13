/**
 * Clear option-cache (local + Mongo), then pull 12 months of 5-minute
 * rolling-option candles and sweep tape for every index.
 *
 * Usage:
 *   npx tsx scripts/warm-5m-cache.ts
 *   npx tsx scripts/warm-5m-cache.ts --keep   # do not delete existing cache
 *   npx tsx scripts/warm-5m-cache.ts --keep --only BANKNIFTY,SENSEX
 *   DHAN_SESSION_PIN=xxxx npx tsx scripts/warm-5m-cache.ts
 */
import { readFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { INDEX_INSTRUMENTS, getIndexByParam } from "../app/lib/dhan/instruments";
import { loadSweepBars } from "../app/lib/dhan/intraday-5m";
import {
  fetchRollingBundle,
  startOptionCacheSync,
} from "../app/lib/dhan/rolling-options";
import { getAccessToken } from "../app/lib/dhan/auth";
import { takeWorkerPin } from "../app/lib/dhan/pin";
import { getCacheDir } from "../app/lib/data-dir";
import { atmBandKeys } from "../app/lib/strategies/expiry-day";
import { strikeKey } from "../app/lib/strategies/common";
import { projectOneStrategy } from "../app/lib/strategies/project-one";
import { sweepFadeStrategy } from "../app/lib/strategies/liquidity-sweep";
import { bootCloudStores } from "../app/lib/store/boot";
import { isMongoConfigured, mongoCollection } from "../app/lib/mongo";

try {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    if (process.env[key]) continue;
    process.env[key] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {
  /* process.env already set */
}

const keep = process.argv.includes("--keep");
const onlyArg = (() => {
  const idx = process.argv.indexOf("--only");
  if (idx >= 0) return process.argv[idx + 1] ?? "";
  const inline = process.argv.find((a) => a.startsWith("--only="));
  return inline ? inline.slice("--only=".length) : "";
})();
const onlyIds = onlyArg
  ? onlyArg.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
  : [];
const instruments = onlyIds.length
  ? onlyIds
      .map((id) => getIndexByParam(id))
      .filter((row): row is (typeof INDEX_INSTRUMENTS)[number] => Boolean(row))
  : INDEX_INSTRUMENTS;
const months = 12;
const widthSteps = 4;

takeWorkerPin();

function clearLocalCache() {
  const cacheDir = getCacheDir();
  if (existsSync(cacheDir)) {
    const before = readdirSync(cacheDir).filter((n) => n.endsWith(".json")).length;
    rmSync(cacheDir, { recursive: true, force: true });
    console.log(`[warm] deleted local cache (${before} files)`);
  } else {
    console.log("[warm] no local cache directory");
  }
}

async function clearMongoCache() {
  if (!isMongoConfigured()) {
    console.log("[warm] Mongo not configured — skipped remote option-cache wipe");
    return;
  }
  const col = await mongoCollection<{ _id: string }>("blobs");
  if (!col) {
    console.log("[warm] Mongo blobs collection unavailable");
    return;
  }
  const result = await col.deleteMany({ _id: { $regex: "^option-cache/" } });
  console.log(`[warm] deleted ${result.deletedCount} Mongo option-cache blobs`);
}

if (!keep) clearLocalCache();
await bootCloudStores();
if (!keep) await clearMongoCache();

function strikeKeysForWarm() {
  return [
    ...new Set([
      ...atmBandKeys(6),
      ...projectOneStrategy.requiredStrikeKeys(widthSteps),
      ...sweepFadeStrategy.requiredStrikeKeys(widthSteps),
      strikeKey(0),
    ]),
  ];
}

async function warmInstrument(instrument: (typeof INDEX_INSTRUMENTS)[number]) {
  const to = new Date();
  const from = new Date(to);
  from.setMonth(from.getMonth() - months);
  const keys = strikeKeysForWarm();
  console.log(
    `[warm] ${instrument.id} 5m options ${from.toISOString().slice(0, 10)}→${to.toISOString().slice(0, 10)} (${keys.length} strikes × CALL/PUT)`,
  );

  await fetchRollingBundle(
    instrument,
    keys,
    ["CALL", "PUT"],
    from,
    to,
    (p) => {
      if (p.done === p.total || p.done % 10 === 0) {
        console.log(
          `[warm] ${instrument.id} options ${p.done}/${p.total} cached=${p.cached} fetched=${p.fetched} ${p.label}`,
        );
      }
    },
    5,
  );

  console.log(`[warm] ${instrument.id} 5m sweep tape (index + ATM volume)`);
  const bars = await loadSweepBars(instrument, from, to);
  console.log(`[warm] ${instrument.id} sweep bars: ${bars.length}`);
}

try {
  await getAccessToken();
  console.log("[warm] Dhan access token ready");
} catch (error) {
  console.error(
    "[warm] No usable Dhan token. Unlock the app with your PIN, or set DHAN_SESSION_PIN and re-run.",
  );
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

if (instruments.length === 0) {
  console.error("[warm] No instruments selected. Use --only NIFTY,BANKNIFTY,SENSEX");
  process.exit(1);
}
console.log(`[warm] instruments: ${instruments.map((i) => i.id).join(", ")}`);

const started = Date.now();
for (const instrument of instruments) {
  await warmInstrument(instrument);
}

console.log("[warm] uploading local cache to Mongo…");
startOptionCacheSync();
// Give fire-and-forget uploads a head start before exit.
await new Promise((resolve) => setTimeout(resolve, 15_000));

const cacheDir = getCacheDir();
const files = existsSync(cacheDir)
  ? readdirSync(cacheDir).filter((n) => n.endsWith(".json"))
  : [];
const m5 = files.filter((n) => n.startsWith("m5_")).length;
const i5 = files.filter((n) => n.startsWith("i5_")).length;
console.log(
  `[warm] done in ${Math.round((Date.now() - started) / 1000)}s — ${files.length} files (m5=${m5}, i5=${i5})`,
);
process.exit(0);
