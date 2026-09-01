/**
 * Verify Dhan token setup from the command line.
 *
 *   DHAN_CLIENT_ID=... DHAN_PIN=... DHAN_TOTP_SECRET=... npx tsx scripts/dhan-token.ts
 *
 * Mints a fresh access token via TOTP auto-login (the same code path the app
 * uses) and prints a masked summary. Handy for confirming DHAN_PIN /
 * DHAN_TOTP_SECRET are correct before relying on hands-off refresh. Nothing
 * secret is printed — the token is masked.
 */
import { generateViaTotp, getAuthStatus } from "../app/lib/dhan/auth";
import { DhanApiError, DhanConfigError } from "../app/lib/dhan/errors";

function mask(token: string) {
  if (token.length <= 12) return "****";
  return `${token.slice(0, 6)}…${token.slice(-4)} (${token.length} chars)`;
}

const status = getAuthStatus();
if (!status.totpReady) {
  console.error(
    "TOTP is not configured. Set DHAN_CLIENT_ID, DHAN_PIN, and DHAN_TOTP_SECRET, then re-run.",
  );
  process.exit(1);
}

try {
  console.log("Requesting a fresh access token via TOTP…");
  const auth = await generateViaTotp();
  console.log("Success — TOTP auto-login works.");
  console.log(`  client:  ${auth.clientId ?? "?"}${auth.clientName ? ` (${auth.clientName})` : ""}`);
  console.log(`  expires: ${auth.expiryTime ?? "unknown"}`);
  console.log(`  token:   ${mask(auth.accessToken)}`);
} catch (error) {
  if (error instanceof DhanConfigError || error instanceof DhanApiError) {
    console.error(`Failed: ${error.message}`);
  } else {
    console.error("Failed:", error);
  }
  process.exit(1);
}
