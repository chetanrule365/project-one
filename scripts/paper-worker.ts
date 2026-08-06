import { readFileSync } from "node:fs";
import { ensurePaperWorker, getPaperWorkerStatus } from "../app/lib/lab/paper-worker";

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}

ensurePaperWorker();
console.log("[paper:worker] headless mode — keep this process running");
console.log("[paper:worker] status", getPaperWorkerStatus());

// Keep event loop alive
setInterval(() => {
  const status = getPaperWorkerStatus();
  if (status.lastError) {
    console.log("[paper:worker] last error:", status.lastError);
  }
}, 10 * 60_000);
