import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Use an isolated data dir so we never touch a real token file.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "dhan-auth-test-"));

const auth = await import("../app/lib/dhan/auth");
const { DhanConfigError } = await import("../app/lib/dhan/errors");

function clearAuthEnv() {
  for (const key of [
    "DHAN_CLIENT_ID",
    "DHAN_PIN",
    "DHAN_TOTP_SECRET",
    "DHAN_APP_ID",
    "DHAN_APP_SECRET",
    "DHAN_API_ID",
    "DHAN_API_SECRET",
    "DHAN_API_KEY",
    "DHAN_ACCESS_TOKEN",
  ]) {
    delete process.env[key];
  }
}

// --- 1. TOTP matches RFC 6238 SHA1 test vectors ----------------------------
// Secret = ASCII "12345678901234567890" -> base32 below.
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
assert.equal(
  auth.generateTotp(RFC_SECRET, { atMs: 59_000 }),
  "287082",
  "TOTP RFC vector @59s",
);
assert.equal(
  auth.generateTotp(RFC_SECRET, { atMs: 1_111_111_109_000 }),
  "081804",
  "TOTP RFC vector @1111111109s",
);
console.log("[test] TOTP RFC 6238 vectors ok");

// --- 2. Token precedence without any network -------------------------------
clearAuthEnv();
auth.clearToken();
await assert.rejects(
  auth.getAccessToken(),
  (err: unknown) => err instanceof DhanConfigError,
  "throws when no token source is configured",
);

process.env.DHAN_ACCESS_TOKEN = "ENV_TOKEN";
assert.equal(await auth.getAccessToken(), "ENV_TOKEN", "falls back to env token");

auth.setManualToken("MANUAL_TOKEN", "1000000001");
assert.equal(
  await auth.getAccessToken(),
  "MANUAL_TOKEN",
  "stored manual token wins over env token",
);
assert.equal(auth.getClientId(), "1000000001", "manual client id stored");

auth.clearToken();
assert.equal(
  await auth.getAccessToken(),
  "ENV_TOKEN",
  "clearing stored token falls back to env again",
);
console.log("[test] token precedence ok");

// --- 3. Network flows against a local mock auth server ---------------------
let generateHits = 0;
let consumeHits = 0;
let expiryMinutes = 24 * 60; // far future by default

function isoIstInMinutes(minutes: number) {
  // Return a tz-less IST timestamp `minutes` from now (matches Dhan format).
  const istNow = Date.now() + 5.5 * 60 * 60 * 1000 + minutes * 60_000;
  return new Date(istNow).toISOString().replace(/Z$/, "").replace(/\.\d+$/, "");
}

const server: Server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  res.setHeader("Content-Type", "application/json");

  if (url.pathname === "/app/generateAccessToken") {
    generateHits += 1;
    res.end(
      JSON.stringify({
        accessToken: `TOTP_TOKEN_${generateHits}`,
        dhanClientId: url.searchParams.get("dhanClientId"),
        dhanClientName: "TEST USER",
        expiryTime: isoIstInMinutes(expiryMinutes),
      }),
    );
    return;
  }
  if (url.pathname === "/app/generate-consent") {
    res.end(JSON.stringify({ consentAppId: "consent-123", consentAppStatus: "GENERATED", status: "success" }));
    return;
  }
  if (url.pathname === "/app/consumeApp-consent") {
    consumeHits += 1;
    res.end(
      JSON.stringify({
        accessToken: "OAUTH_TOKEN",
        dhanClientId: "1000000042",
        dhanClientName: "OAUTH USER",
        expiryTime: isoIstInMinutes(24 * 60),
      }),
    );
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ message: "not found" }));
});

await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("no server address");
process.env.DHAN_AUTH_BASE = `http://127.0.0.1:${address.port}`;

try {
  // 3a. TOTP mint via the endpoint.
  clearAuthEnv();
  auth.clearToken();
  process.env.DHAN_CLIENT_ID = "1000000001";
  process.env.DHAN_PIN = "1234";
  process.env.DHAN_TOTP_SECRET = RFC_SECRET;

  const first = await auth.getAccessToken();
  assert.equal(first, "TOTP_TOKEN_1", "mints token via TOTP endpoint");
  assert.equal(generateHits, 1, "one mint so far");

  // 3b. Far-future token is cached (no re-mint).
  const cached = await auth.getAccessToken();
  assert.equal(cached, "TOTP_TOKEN_1", "reuses cached fresh token");
  assert.equal(generateHits, 1, "no extra mint for fresh token");

  // 3c. Near-expiry token auto-refreshes.
  expiryMinutes = 2; // inside the 15-min refresh margin
  auth.clearToken();
  const refreshedA = await auth.getAccessToken();
  const refreshedB = await auth.getAccessToken();
  assert.notEqual(refreshedA, refreshedB, "re-mints when token is near expiry");
  assert.ok(generateHits >= 3, "auto-refresh minted again");
  console.log("[test] TOTP mint + cache + auto-refresh ok");

  // 3d. OAuth creds resolve from DHAN_API_ID / DHAN_API_SECRET aliases too.
  clearAuthEnv();
  assert.equal(auth.hasOAuthCreds(), false, "no oauth creds by default");
  process.env.DHAN_API_ID = "api-key-alias";
  process.env.DHAN_API_SECRET = "api-secret-alias";
  assert.equal(auth.hasOAuthCreds(), true, "oauth creds detected via DHAN_API_* alias");
  delete process.env.DHAN_API_ID;
  delete process.env.DHAN_API_SECRET;

  // 3e. OAuth consent + consume.
  clearAuthEnv();
  auth.clearToken();
  process.env.DHAN_APP_ID = "app-key";
  process.env.DHAN_APP_SECRET = "app-secret";

  const consent = await auth.generateConsent();
  assert.equal(consent.consentAppId, "consent-123", "consent id returned");
  assert.match(consent.loginUrl, /consentApp-login\?consentAppId=consent-123/, "login url built");

  const stored = await auth.consumeConsent("token-abc");
  assert.equal(stored.accessToken, "OAUTH_TOKEN", "oauth token stored");
  assert.equal(consumeHits, 1, "consume endpoint hit");
  assert.equal(await auth.getAccessToken(), "OAUTH_TOKEN", "oauth token used");

  const status = auth.getAuthStatus();
  assert.equal(status.source, "oauth", "status reports oauth source");
  assert.equal(status.clientId, "1000000042", "status reports client id");
  assert.equal(status.connected, true, "status connected");
  console.log("[test] OAuth consent + consume + status ok");
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

console.log("dhan-auth ok");
