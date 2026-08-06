/**
 * Production entry: start paper worker, then serve the React Router app.
 * Used on Railway so Tuesday syncs run even if nobody opens /lab.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensurePaperWorker } from "../app/lib/lab/paper-worker";

ensurePaperWorker();
console.log("[boot] paper worker ensured; starting react-router-serve");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverEntry = path.join(root, "build", "server", "index.js");
const serveCli = path.join(
  root,
  "node_modules",
  "@react-router",
  "serve",
  "bin.js",
);

const child = spawn(process.execPath, [serveCli, serverEntry], {
  stdio: "inherit",
  env: process.env,
  cwd: root,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    child.kill(sig);
  });
}
