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

export function getDhanCredentials() {
  const clientId = process.env.DHAN_CLIENT_ID?.trim();
  const accessToken = process.env.DHAN_ACCESS_TOKEN?.trim();

  if (!clientId || !accessToken) {
    throw new DhanConfigError(
      "Missing DHAN_CLIENT_ID or DHAN_ACCESS_TOKEN. Add them to your .env file.",
    );
  }

  // DhanHQ v2 access tokens are JWTs (typically 200+ chars, three dot-separated parts).
  // API key / API secret / truncated values produce a generic 401 from /marketfeed/ohlc.
  if (accessToken.split(".").length !== 3 || accessToken.length < 80) {
    throw new DhanConfigError(
      "DHAN_ACCESS_TOKEN is not a Dhan JWT access token. In web.dhan.co open My Profile → Access DhanHQ APIs and generate an Access Token (long JWT, valid ~24 hours). Do not use the API key or API secret.",
    );
  }

  return { clientId, accessToken };
}

export class DhanConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DhanConfigError";
  }
}

export class DhanApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "DhanApiError";
    this.status = status;
  }
}

/** Pull a human-readable message out of Dhan JSON, including `{ data: { "808": "..." } }` auth errors. */
export function formatDhanError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const body = payload as Record<string, unknown>;

  for (const key of ["errorMessage", "message"] as const) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return value;
  }

  if (typeof body.remarks === "string" && body.remarks.trim()) {
    return body.remarks;
  }

  const data = body.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const coded = Object.entries(data as Record<string, unknown>)
      .filter(
        ([code, value]) =>
          /^\d+$/.test(code) && typeof value === "string" && value.trim(),
      )
      .map(([code, value]) => `${code}: ${value}`);
    if (coded.length) return coded.join("; ");
  }

  return fallback;
}

export async function dhanPost<T>(
  path: string,
  body: unknown,
): Promise<{ status: number; payload: T }> {
  const { clientId, accessToken } = getDhanCredentials();
  const response = await fetch(`${getDhanApiBase()}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "access-token": accessToken,
      "client-id": clientId,
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json()) as T;
  return { status: response.status, payload };
}

/** Dhan option-chain / charts endpoints allow ~1 request / 3s. Serialize + space them out. */
const OPTION_CHAIN_GAP_MS = 3_200;
const globalRateLimit = globalThis as typeof globalThis & {
  __dhanGates?: Record<
    string,
    { gate: Promise<void>; nextAt: number }
  >;
};

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function dhanOptionChainPost<T>(
  path: string,
  body: unknown,
): Promise<{ status: number; payload: T }> {
  return dhanRateLimitedPost(path, body, "optionchain");
}

/** Generic rate-limited POST (charts / rollingoption share a gate). */
export async function dhanRateLimitedPost<T>(
  path: string,
  body: unknown,
  gateKey: string,
  gapMs = OPTION_CHAIN_GAP_MS,
): Promise<{ status: number; payload: T }> {
  const gates = (globalRateLimit.__dhanGates ??= {});
  const existing = gates[gateKey] ?? { gate: Promise.resolve(), nextAt: 0 };
  const previous = existing.gate;

  let release!: () => void;
  const nextGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  gates[gateKey] = { gate: previous.then(() => nextGate), nextAt: existing.nextAt };

  await previous;

  try {
    const delay = (gates[gateKey]?.nextAt ?? 0) - Date.now();
    if (delay > 0) await wait(delay);

    let attempt = 0;
    while (true) {
      const result = await dhanPost<T>(path, body);
      if (gates[gateKey]) {
        gates[gateKey].nextAt = Date.now() + gapMs;
      }

      if (result.status !== 429 || attempt >= 2) {
        return result;
      }

      attempt += 1;
      await wait(gapMs);
    }
  } finally {
    release();
  }
}

export { DEFAULT_PROD_BASE, DEFAULT_SANDBOX_BASE };
