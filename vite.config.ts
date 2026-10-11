import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

function jobStatusPlugin(): Plugin {
  const handle = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url ?? "";
    if (req.method !== "GET" || !url.startsWith("/__backtest-job")) {
      next();
      return;
    }
    const dir = process.env.DATA_DIR?.trim()
      ? path.resolve(process.env.DATA_DIR.trim())
      : path.join(process.cwd(), "data");
    const file = path.join(dir, "backtest-job.json");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    try {
      const job = existsSync(file)
        ? JSON.parse(readFileSync(file, "utf8"))
        : {
            status: "idle",
            message: "",
            done: 0,
            total: 0,
            cached: 0,
            fetched: 0,
            startedAt: null,
            finishedAt: null,
            error: null,
            resultId: null,
            pid: null,
          };
      res.end(JSON.stringify({ job }));
    } catch {
      res.statusCode = 500;
      res.end(JSON.stringify({ job: null, error: "job-read-failed" }));
    }
  };
  return {
    name: "backtest-job-status",
    configureServer(server) {
      server.middlewares.use(handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handle);
    },
  };
}

export default defineConfig({
  plugins: [jobStatusPlugin(), tailwindcss(), reactRouter()],
  resolve: {
    tsconfigPaths: true,
  },
  ssr: {
    external: ["mongodb", "bson"],
  },
  server: {
    watch: {
      // Job/cache JSON rewrites must not remount the page or the live
      // progress banner resets to the stale loader snapshot.
      ignored: ["**/node_modules/**", "**/.git/**", "**/data/**"],
    },
  },
});
