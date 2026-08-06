/**
 * Production entry: start paper worker, then serve the React Router app.
 * Used on Railway so Tuesday syncs run even if nobody opens /lab.
 *
 * Runs serve in-process (not a child) so one process holds PORT and Railway
 * does not restart us for a dead child / unbound port.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensurePaperWorker } from "../app/lib/lab/paper-worker";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverEntry = path.join(root, "build", "server", "index.js");

if (!existsSync(serverEntry)) {
  console.error(`[boot] missing server build at ${serverEntry}`);
  process.exit(1);
}

// Containers / Railway need a public bind; react-router-serve respects HOST.
process.env.HOST ??= "0.0.0.0";

ensurePaperWorker();
console.log("[boot] paper worker ensured; starting react-router-serve");
console.log(
  `[boot] PORT=${process.env.PORT ?? "(unset)"} DATA_DIR=${process.env.DATA_DIR ?? "(default ./data)"}`,
);

// cli.js reads process.argv[2] as the server build path (load via absolute path;
// package exports do not expose dist/cli.js).
const serveCli = path.join(
  root,
  "node_modules",
  "@react-router",
  "serve",
  "dist",
  "cli.js",
);
if (!existsSync(serveCli)) {
  console.error(`[boot] missing react-router-serve at ${serveCli}`);
  process.exit(1);
}
process.argv = [process.argv[0], "react-router-serve", serverEntry];
createRequire(import.meta.url)(serveCli);
