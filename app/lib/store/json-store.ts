import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getDataDir } from "../data-dir";
import { isMongoConfigured } from "../mongo";
import { blobReadJson, blobSetJson } from "./blob";
import { kvDelete, kvGet, kvSet } from "./kv";

export function createJsonStore<T>(opts: {
  key: string;
  fileName: string;
  empty: () => T;
  debounceMs?: number;
  /** `kv` is JSON docs; `blob` is gzip for large backtest files. */
  remote?: "kv" | "blob";
}) {
  let cache: T | null = null;
  /** mtime of the file when `cache` was last read/written (worker may update disk out-of-process). */
  let cacheMtimeMs = 0;
  let remoteReady = false;
  let hydrating: Promise<void> | null = null;
  let remoteTimer: ReturnType<typeof setTimeout> | null = null;

  function filePath() {
    mkdirSync(getDataDir(), { recursive: true });
    return path.join(getDataDir(), opts.fileName);
  }

  function readLocal(): T {
    const file = filePath();
    if (!existsSync(file)) return opts.empty();
    try {
      return { ...opts.empty(), ...(JSON.parse(readFileSync(file, "utf8")) as T) };
    } catch {
      return opts.empty();
    }
  }

  function localMtimeMs() {
    try {
      return statSync(filePath()).mtimeMs;
    } catch {
      return 0;
    }
  }

  /** Prefer higher nextId then more runs so a remote empty clear cannot wipe a richer local save. */
  function contentRank(state: unknown): number {
    if (!state || typeof state !== "object") return 0;
    const s = state as { nextId?: number; runs?: unknown[] };
    const nextId = typeof s.nextId === "number" ? s.nextId : 0;
    const runs = Array.isArray(s.runs) ? s.runs.length : 0;
    if (nextId || runs) return nextId * 1_000_000 + runs;
    return 0;
  }

  function writeLocal(state: T) {
    try {
      writeFileSync(filePath(), JSON.stringify(state, null, 2));
      cacheMtimeMs = localMtimeMs();
    } catch (error) {
      console.error(`[store] failed to write ${opts.fileName}`, error);
    }
  }

  function refreshFromDiskIfNewer() {
    const mtime = localMtimeMs();
    if (cache && mtime <= cacheMtimeMs) return;
    cache = readLocal();
    cacheMtimeMs = mtime;
  }

  async function hydrate() {
    if (remoteReady) return;
    if (hydrating) {
      await hydrating;
      return;
    }
    hydrating = (async () => {
      if (opts.remote === "blob") {
        if (isMongoConfigured()) {
          await hydrateBlob();
        } else {
          cache = readLocal();
        }
        remoteReady = true;
        return;
      }
      if (!isMongoConfigured()) {
        cache = readLocal();
        remoteReady = true;
        return;
      }
      const remote = await kvGet<T>(opts.key);
      if (!remote.ok) {
        cache = readLocal();
        throw new Error(`[store] ${opts.key} hydrate failed`);
      }
      if (remote.value) {
        const remoteAt = Date.parse(remote.updatedAt ?? "") || 0;
        const local = readLocal();
        const merged = { ...opts.empty(), ...remote.value };
        if (contentRank(local) > contentRank(merged)) {
          cache = local;
          cacheMtimeMs = localMtimeMs();
          await kvSet(opts.key, cache);
        } else if (remoteAt >= localMtimeMs()) {
          cache = merged;
          writeLocal(cache);
        } else {
          cache = local;
          cacheMtimeMs = localMtimeMs();
          await kvSet(opts.key, cache);
        }
      } else {
        cache = readLocal();
        cacheMtimeMs = localMtimeMs();
        await kvSet(opts.key, cache);
      }
      remoteReady = true;
    })().finally(() => {
      hydrating = null;
    });
    await hydrating;
  }

  function load(): T {
    refreshFromDiskIfNewer();
    if (cache) return cache;
    cache = readLocal();
    cacheMtimeMs = localMtimeMs();
    return cache;
  }

  function blobPath() {
    return `${opts.key}/${opts.fileName}`;
  }

  async function hydrateBlob() {
    const remote = await blobReadJson(blobPath());
    if (!remote.ok) {
      cache = readLocal();
      cacheMtimeMs = localMtimeMs();
      throw new Error(`[store] ${opts.key} blob hydrate failed`);
    }
    if (remote.json) {
      try {
        const parsed = { ...opts.empty(), ...(JSON.parse(remote.json) as T) };
        const local = readLocal();
        if (remote.updatedAtMs >= localMtimeMs() && contentRank(parsed) >= contentRank(local)) {
          cache = parsed;
          writeLocal(cache);
          return;
        }
        if (contentRank(local) > contentRank(parsed)) {
          cache = local;
          cacheMtimeMs = localMtimeMs();
          await blobSetJson(blobPath(), JSON.stringify(cache));
          return;
        }
      } catch {
        /* fall through to local / kv migrate */
      }
    }
    const legacy = await kvGet<T>(opts.key);
    if (!remote.json && legacy.ok && legacy.value) {
      cache = { ...opts.empty(), ...legacy.value };
      writeLocal(cache);
      await blobSetJson(blobPath(), JSON.stringify(cache));
      await kvDelete(opts.key);
      return;
    }
    cache = readLocal();
    cacheMtimeMs = localMtimeMs();
    await blobSetJson(blobPath(), JSON.stringify(cache));
  }

  function persist(state: T) {
    cache = state;
    writeLocal(state);
    if (!remoteReady || !isMongoConfigured()) return;
    const push = () => {
      remoteTimer = null;
      if (opts.remote === "blob") {
        void blobSetJson(blobPath(), JSON.stringify(cache));
        return;
      }
      void kvSet(opts.key, cache);
    };
    if (!opts.debounceMs) {
      push();
      return;
    }
    if (remoteTimer) clearTimeout(remoteTimer);
    remoteTimer = setTimeout(push, opts.debounceMs);
  }

  async function pull() {
    refreshFromDiskIfNewer();
    if (opts.remote === "blob") {
      if (!remoteReady || !isMongoConfigured()) return;
      const remote = await blobReadJson(blobPath());
      if (!remote.ok || !remote.json) return;
      try {
        const parsed = { ...opts.empty(), ...(JSON.parse(remote.json) as T) };
        const local = cache ?? readLocal();
        if (contentRank(local) > contentRank(parsed)) {
          await blobSetJson(blobPath(), JSON.stringify(local));
          return;
        }
        if (remote.updatedAtMs <= localMtimeMs() + 250) return;
        cache = parsed;
        writeLocal(cache);
      } catch {
        /* keep local */
      }
      return;
    }
    if (!remoteReady || !isMongoConfigured()) return;
    const remote = await kvGet<T>(opts.key);
    if (!remote.ok || !remote.value) return;
    const remoteAt = Date.parse(remote.updatedAt ?? "") || 0;
    const local = cache ?? readLocal();
    if (contentRank(local) > contentRank(remote.value)) {
      await kvSet(opts.key, local);
      return;
    }
    if (remoteAt <= localMtimeMs() + 250) return;
    cache = { ...opts.empty(), ...remote.value };
    writeLocal(cache);
  }

  return { hydrate, load, persist, pull };
}
