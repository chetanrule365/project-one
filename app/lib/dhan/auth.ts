import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getDataDir } from "../data-dir";
import { DhanApiError, DhanConfigError } from "./errors";

/**
 * Single source of truth for the Dhan access token.
 *
 * A Dhan access token is only valid for ~24 hours, which previously meant
 * hand-editing DHAN_ACCESS_TOKEN in the environment every single day. This
 * module removes that daily chore by resolving (and, where possible,
 * automatically refreshing) the token from one of several sources:
 *
 *   1. A token persisted to the data volume (minted via TOTP), reused until it
 *      is close to expiry.
 *   2. TOTP auto-login — when DHAN_CLIENT_ID + DHAN_PIN + DHAN_TOTP_SECRET are
 *      set, a fresh token is minted headlessly on demand (fully hands-off).
 *   3. The legacy DHAN_ACCESS_TOKEN env var (kept for backward compatibility).
 */

export type TokenSource = "totp" | "env";

export type StoredAuth = {
  accessToken: string;
  clientId: string | null;
  clientName: string | null;
  /** ISO timestamp (IST) reported by Dhan, or null when unknown. */
  expiryTime: string | null;
  source: TokenSource;
  updatedAt: string;
};

/** Refresh a token this long before its stated expiry. */
const REFRESH_MARGIN_MS = 15 * 60_000;
/** Assumed validity window for tokens with no known expiry (Dhan ≈ 24h). */
const ASSUMED_VALIDITY_MS = (24 * 60 - 15) * 60_000;

const globalForAuth = globalThis as typeof globalThis & {
  __dhanAuth?: {
    current: StoredAuth | null;
    loaded: boolean;
    inflight: Promise<string> | null;
  };
};

function memory() {
  if (!globalForAuth.__dhanAuth) {
    globalForAuth.__dhanAuth = { current: null, loaded: false, inflight: null };
  }
  return globalForAuth.__dhanAuth;
}

function authFilePath() {
  return path.join(getDataDir(), "dhan-auth.json");
}

function authApiBase() {
  const configured = process.env.DHAN_AUTH_BASE?.trim();
  return (configured || "https://auth.dhan.co").replace(/\/$/, "");
}

function readStored(): StoredAuth | null {
  const mem = memory();
  if (mem.loaded) return mem.current;

  try {
    const raw = readFileSync(authFilePath(), "utf8");
    const parsed = JSON.parse(raw) as StoredAuth;
    mem.current = parsed?.accessToken ? parsed : null;
  } catch {
    mem.current = null;
  }
  mem.loaded = true;
  return mem.current;
}

function persist(input: Omit<StoredAuth, "updatedAt">): StoredAuth {
  const auth: StoredAuth = { ...input, updatedAt: new Date().toISOString() };
  const mem = memory();
  mem.current = auth;
  mem.loaded = true;
  try {
    mkdirSync(getDataDir(), { recursive: true });
    writeFileSync(authFilePath(), JSON.stringify(auth, null, 2), "utf8");
  } catch (error) {
    console.error("[dhan-auth] failed to persist token", error);
  }
  return auth;
}

/** Parse a Dhan expiry timestamp, treating tz-less values as IST (+05:30). */
function parseExpiryMs(iso: string | null): number | null {
  if (!iso) return null;
  const hasTz = /([zZ]|[+-]\d\d:?\d\d)$/.test(iso);
  if (hasTz) {
    const t = Date.parse(iso);
    return Number.isNaN(t) ? null : t;
  }
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) {
    const t = Date.parse(iso);
    return Number.isNaN(t) ? null : t;
  }
  const [, y, mo, d, h, mi, s] = m;
  const utc = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
  );
  return utc - 5.5 * 60 * 60 * 1000;
}

function msLeft(auth: StoredAuth): number | null {
  const expiry = parseExpiryMs(auth.expiryTime);
  if (expiry != null) return expiry - Date.now();
  const updated = Date.parse(auth.updatedAt);
  if (Number.isNaN(updated)) return null;
  return updated + ASSUMED_VALIDITY_MS - Date.now();
}

/** Token is present and comfortably before expiry. */
function isFresh(auth: StoredAuth): boolean {
  if (!auth.accessToken) return false;
  const left = msLeft(auth);
  if (left == null) return true;
  return left > REFRESH_MARGIN_MS;
}

/** Token is present and not yet past expiry (may be within refresh margin). */
function isUsable(auth: StoredAuth): boolean {
  if (!auth.accessToken) return false;
  const left = msLeft(auth);
  if (left == null) return true;
  return left > 0;
}

function hasTotpCreds(): boolean {
  return Boolean(
    process.env.DHAN_CLIENT_ID?.trim() &&
      process.env.DHAN_PIN?.trim() &&
      process.env.DHAN_TOTP_SECRET?.trim(),
  );
}

// --- TOTP (RFC 6238) --------------------------------------------------------

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Generate a time-based one-time password from a base32 secret. */
export function generateTotp(
  secret: string,
  { stepSeconds = 30, digits = 6, atMs = Date.now() } = {},
): string {
  const key = base32Decode(secret);
  if (key.length === 0) {
    throw new DhanConfigError("DHAN_TOTP_SECRET is not a valid base32 secret.");
  }
  let counter = Math.floor(atMs / 1000 / stepSeconds);
  const buffer = Buffer.alloc(8);
  for (let i = 7; i >= 0; i -= 1) {
    buffer[i] = counter & 0xff;
    counter = Math.floor(counter / 256);
  }
  const hmac = createHmac("sha1", key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (binary % 10 ** digits).toString().padStart(digits, "0");
}

// --- Token acquisition ------------------------------------------------------

type DhanTokenResponse = {
  accessToken?: string;
  dhanClientId?: string;
  dhanClientName?: string;
  expiryTime?: string;
  error?: string;
  message?: string;
  errorMessage?: string;
};

async function parseJson(response: Response): Promise<DhanTokenResponse> {
  try {
    return (await response.json()) as DhanTokenResponse;
  } catch {
    return {};
  }
}

function tokenError(payload: DhanTokenResponse, status: number, fallback: string) {
  return new DhanApiError(
    payload.errorMessage || payload.message || payload.error || fallback,
    status,
  );
}

/** Mint a fresh token headlessly using PIN + TOTP (no browser needed). */
export async function generateViaTotp(): Promise<StoredAuth> {
  const clientId = process.env.DHAN_CLIENT_ID?.trim();
  const pin = process.env.DHAN_PIN?.trim();
  const secret = process.env.DHAN_TOTP_SECRET?.trim();
  if (!clientId || !pin || !secret) {
    throw new DhanConfigError(
      "TOTP auto-login needs DHAN_CLIENT_ID, DHAN_PIN, and DHAN_TOTP_SECRET.",
    );
  }

  const totp = generateTotp(secret);
  const url = new URL(`${authApiBase()}/app/generateAccessToken`);
  url.searchParams.set("dhanClientId", clientId);
  url.searchParams.set("pin", pin);
  url.searchParams.set("totp", totp);

  const response = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  const payload = await parseJson(response);
  if (!response.ok || !payload.accessToken) {
    throw tokenError(
      payload,
      response.status,
      `TOTP token generation failed (${response.status})`,
    );
  }

  console.log("[dhan-auth] minted access token via TOTP");
  return persist({
    accessToken: payload.accessToken,
    clientId: payload.dhanClientId ?? clientId,
    clientName: payload.dhanClientName ?? null,
    expiryTime: payload.expiryTime ?? null,
    source: "totp",
  });
}

/** Forget any stored token. */
export function clearToken(): void {
  const mem = memory();
  mem.current = null;
  mem.loaded = true;
  try {
    rmSync(authFilePath());
  } catch {
    // no stored file — nothing to clear
  }
}

export function getClientId(): string | null {
  const env = process.env.DHAN_CLIENT_ID?.trim();
  if (env) return env;
  return readStored()?.clientId ?? null;
}

/**
 * Resolve a usable access token, refreshing automatically when possible.
 * Concurrent callers share a single in-flight refresh.
 */
export async function getAccessToken(): Promise<string> {
  const mem = memory();
  const stored = readStored();

  if (stored && isFresh(stored)) return stored.accessToken;

  if (hasTotpCreds()) {
    if (!mem.inflight) {
      mem.inflight = generateViaTotp()
        .then((auth) => auth.accessToken)
        .finally(() => {
          mem.inflight = null;
        });
    }
    return mem.inflight;
  }

  if (stored && isUsable(stored)) return stored.accessToken;

  const envToken = process.env.DHAN_ACCESS_TOKEN?.trim();
  if (envToken) return envToken;

  if (stored?.accessToken) return stored.accessToken;

  throw new DhanConfigError(
    "No Dhan access token available. Set up TOTP auto-login (DHAN_CLIENT_ID + DHAN_PIN + DHAN_TOTP_SECRET) or set DHAN_ACCESS_TOKEN.",
  );
}

export type AuthStatus = {
  connected: boolean;
  source: TokenSource | null;
  clientId: string | null;
  clientName: string | null;
  expiryTime: string | null;
  minutesLeft: number | null;
  expired: boolean;
  totpReady: boolean;
  envTokenPresent: boolean;
};

export function getAuthStatus(): AuthStatus {
  const stored = readStored();
  const envTokenPresent = Boolean(process.env.DHAN_ACCESS_TOKEN?.trim());
  const left = stored ? msLeft(stored) : null;
  return {
    connected: Boolean(stored?.accessToken) || envTokenPresent,
    source: stored?.source ?? (envTokenPresent ? "env" : null),
    clientId: getClientId(),
    clientName: stored?.clientName ?? null,
    expiryTime: stored?.expiryTime ?? null,
    minutesLeft: left == null ? null : Math.round(left / 60_000),
    expired: stored ? !isUsable(stored) : false,
    totpReady: hasTotpCreds(),
    envTokenPresent,
  };
}
