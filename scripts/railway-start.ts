/**
 * Production HTTP entry for Railway.
 * Paper worker starts when the SSR server build loads (shared SQLite singleton).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import compression from "compression";
import express from "express";
import { createRequestHandler } from "@react-router/express";
import { getDataDir } from "../app/lib/data-dir";

// Log faults but do NOT exit — killing the process after listen causes Railway crash loops.
process.on("uncaughtException", (error) => {
  console.error("[boot] uncaughtException", error);
});
process.on("unhandledRejection", (reason) => {
  console.error("[boot] unhandledRejection", reason);
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

try {
  const dataDir = getDataDir();
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path.join(dataDir, ".write-test"), new Date().toISOString());
  console.log(`[boot] data dir writable: ${dataDir}`);
} catch (error) {
  console.error("[boot] data dir not writable — paper DB may fail", error);
}

console.log("[boot] loading server build…");
const build = await import(pathToFileURL(serverEntry).href);
console.log("[boot] server build loaded");

const app = express();
app.disable("x-powered-by");
app.get("/healthz", (_req, res) => {
  res.status(200).type("text/plain").send("ok");
});
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
    build: build as never,
    mode: process.env.NODE_ENV,
  }),
);

app.listen(port, host, () => {
  console.log(`[boot] listening on http://${host}:${port}`);
  setInterval(() => {
    console.log(`[boot] heartbeat uptime=${Math.floor(process.uptime())}s`);
  }, 60_000).unref();
});
