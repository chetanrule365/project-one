import { readFileSync } from "node:fs";

try {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    if (process.env[key]) continue;
    process.env[key] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {
  /* ignore */
}

const { bootCloudStores } = await import("../app/lib/store/boot.server");
await bootCloudStores();
const {
  pullBacktestStore,
  clearSavedBacktests,
  listBacktests,
} = await import("../app/lib/lab/backtest-store");
await pullBacktestStore();
const before = listBacktests().length;
clearSavedBacktests();
// Give blob upload a moment.
await new Promise((resolve) => setTimeout(resolve, 2000));
console.log(JSON.stringify({ before, after: listBacktests().length }));
