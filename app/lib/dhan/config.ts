import {
  getAccessToken,
  getClientId,
  invalidateAccessToken,
  noteRejectedToken,
} from "./auth";
import { DhanApiError, DhanConfigError } from "./errors";

export { DhanApiError, DhanConfigError };

const DEFAULT_PROD_BASE = "https://api.dhan.co";
const DEFAULT_SANDBOX_BASE = "https://sandbox.dhan.co";

export function getDhanApiBase() {
  const configured = process.env.DHAN_API_BASE?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return DEFAULT_PROD_BASE;
}

export function isDhanSandbox() {
  return getDhanApiBase().includes("sandbox.dhan.co");
}

/**
 * Resolve the client id + a currently-valid access token. The token is
 * sourced (and auto-refreshed) by the token manager in ./auth, so callers no
 * longer depend on a hand-maintained DHAN_ACCESS_TOKEN env var.
 */
export async function resolveDhanCredentials(): Promise<{
  clientId: string;
  accessToken: string;
}> {
  const accessToken = await getAccessToken();
  const clientId = getClientId();
  if (!clientId) {
    throw new DhanConfigError(
      "Missing DHAN_CLIENT_ID. Set it in the environment.",
    );
  }
  return { clientId, accessToken };
}

async function dhanPostOnce<T>(
  path: string,
  body: unknown,
): Promise<{ status: number; payload: T }> {
  const { clientId, accessToken } = await resolveDhanCredentials();
  const response = await fetch(`${getDhanApiBase()}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "access-token": accessToken,
      "client-id": clientId,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });

  const payload = (await response.json()) as T;
  return { status: response.status, payload };
}

export async function dhanPost<T>(
  path: string,
  body: unknown,
): Promise<{ status: number; payload: T }> {
  const first = await dhanPostOnce<T>(path, body);
  if (first.status !== 401) return first;

  try {
    await getAccessToken({ forceRefresh: true });
  } catch {
    return first;
  }

  const retry = await dhanPostOnce<T>(path, body);
  if (retry.status === 401) {
    invalidateAccessToken();
    noteRejectedToken();
  }
  return retry;
}

/** Dhan allows ~1 request / 3s across Data APIs. One queue; UI jumps bulk jobs. */
const OPTION_CHAIN_GAP_MS = 3_200;
const DHAN_429_RETRIES = 5;

type DhanWaiter = { priority: number; id: number; resume: () => void };

const globalRateLimit = globalThis as typeof globalThis & {
  __dhanQueue?: {
    nextAt: number;
    running: boolean;
    seq: number;
    waiters: DhanWaiter[];
  };
};

function queueState() {
  return (globalRateLimit.__dhanQueue ??= {
    nextAt: 0,
    running: false,
    seq: 0,
    waiters: [],
  });
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function kickQueue() {
  const q = queueState();
  if (q.running || q.waiters.length === 0) return;
  q.waiters.sort((a, b) => b.priority - a.priority || a.id - b.id);
  const next = q.waiters.shift();
  if (!next) return;
  q.running = true;
  next.resume();
}

async function acquireDhanSlot(priority: number) {
  const q = queueState();
  await new Promise<void>((resume) => {
    q.waiters.push({ priority, id: q.seq++, resume });
    kickQueue();
  });
  const delay = q.nextAt - Date.now();
  if (delay > 0) await wait(delay);
}

function releaseDhanSlot(gapMs: number) {
  const q = queueState();
  q.nextAt = Date.now() + gapMs;
  q.running = false;
  kickQueue();
}

export async function dhanOptionChainPost<T>(
  path: string,
  body: unknown,
): Promise<{ status: number; payload: T }> {
  return dhanRateLimitedPost(path, body);
}

/** Generic rate-limited POST. `rollingoption` is bulk (live pages skip the line). */
export async function dhanRateLimitedPost<T>(
  path: string,
  body: unknown,
  gateKey = "dhan",
  gapMs = OPTION_CHAIN_GAP_MS,
): Promise<{ status: number; payload: T }> {
  const priority = gateKey === "rollingoption" || gateKey === "bulk" ? 0 : 1;
  let attempt = 0;
  while (true) {
    await acquireDhanSlot(priority);
    let result: { status: number; payload: T };
    try {
      result = await dhanPost<T>(path, body);
    } finally {
      releaseDhanSlot(gapMs);
    }
    if (result.status !== 429 || attempt >= DHAN_429_RETRIES) {
      return result;
    }
    attempt += 1;
    await wait(gapMs * attempt);
  }
}

export { DEFAULT_PROD_BASE, DEFAULT_SANDBOX_BASE };
