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

export { DEFAULT_PROD_BASE, DEFAULT_SANDBOX_BASE };
