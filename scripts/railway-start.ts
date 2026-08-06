/**
 * Production entry for Railway: bind HTTP first, then start the paper worker.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import compression from "compression";
import express from "express";
import { createRequestHandler } from "@react-router/express";
import { ensurePaperWorker } from "../app/lib/lab/paper-worker";

process.on("uncaughtException", (error) => {
  console.error("[boot] uncaughtException", error);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("[boot] unhandledRejection", reason);
  process.exit(1);
});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverEntry = path.join(root, "build", "server", "index.js");
const clientDir = path.join(root, "build", "client");
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "0.0.0.0";

if (!existsSync(serverEntry)) {
  console.error(`[boot] missing server build at ${serverEntry}`);
  process.exit(1);
}

console.log(
  `[boot] PORT=${port} HOST=${host} DATA_DIR=${process.env.DATA_DIR ?? "(default ./data)"}`,
);
console.log("[boot] loading server build…");

const build = await import(pathToFileURL(serverEntry).href);
console.log("[boot] server build loaded");

const app = express();
app.disable("x-powered-by");
app.use(compression());
app.use(
  "/assets",
  express.static(path.join(clientDir, "assets"), {
    immutable: true,
    maxAge: "1y",
  }),
);
app.use(express.static(clientDir));
app.use(express.static(path.join(root, "public"), { maxAge: "1h" }));
app.all(
  "*",
  createRequestHandler({
    build,
    mode: process.env.NODE_ENV,
  }),
);

app.listen(port, host, () => {
  console.log(`[boot] listening on http://${host}:${port}`);
  ensurePaperWorker();
  console.log("[boot] paper worker ensured");
});
