import { decryptSecret, encryptSecret } from "../secret.server";

const COOKIE = "po_session";
const MAX_AGE_SEC = 7 * 24 * 60 * 60;

const globalForPin = globalThis as typeof globalThis & {
  __dhanPin?: { value: string | null };
};

function memory() {
  if (!globalForPin.__dhanPin) {
    globalForPin.__dhanPin = { value: null };
  }
  return globalForPin.__dhanPin;
}

function cookieSecure(request: Request) {
  return new URL(request.url).protocol === "https:" ? "; Secure" : "";
}

export function pinSetCookie(pin: string, request: Request) {
  const value = encryptSecret(pin.trim());
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SEC}${cookieSecure(request)}`;
}

export function pinClearCookie(request: Request) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cookieSecure(request)}`;
}

export function hydratePinFromRequest(request: Request) {
  const header = request.headers.get("cookie") ?? "";
  const match = header.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]*)`));
  if (!match?.[1]) return;
  const pin = decryptSecret(match[1]);
  if (pin && isValidPin(pin)) setPin(pin);
}

export function getPin(): string | null {
  return memory().value;
}

export function hasPin() {
  return Boolean(getPin());
}

export function setPin(pin: string) {
  const value = pin.trim();
  memory().value = value || null;
}

export function clearPin() {
  memory().value = null;
}

export function isValidPin(pin: string) {
  return /^\d{4,8}$/.test(pin.trim());
}

export function takeWorkerPin() {
  const pin = process.env.DHAN_SESSION_PIN?.trim();
  if (!pin) return;
  delete process.env.DHAN_SESSION_PIN;
  if (isValidPin(pin)) setPin(pin);
}
