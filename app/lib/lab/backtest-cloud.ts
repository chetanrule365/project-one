export function isCloudRuntime() {
  return Boolean(
    process.env.RAILWAY_ENVIRONMENT?.trim() ||
      process.env.CLOUD_WORKER === "1",
  );
}

export function cloudAppUrl() {
  const explicit = process.env.CLOUD_APP_URL?.trim().replace(/\/$/, "");
  if (explicit) return explicit;
  const domain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  if (domain && isCloudRuntime()) return `https://${domain.replace(/^https?:\/\//, "")}`;
  return "";
}

export function isCloudBacktestClient() {
  return Boolean(cloudAppUrl() && !isCloudRuntime());
}

export function cloudWorkerSecret() {
  return process.env.CLOUD_WORKER_SECRET?.trim() || "";
}

let lastWakeMs = 0;

export async function keepCloudAwake() {
  const base = cloudAppUrl();
  if (!base) return;
  if (Date.now() - lastWakeMs < 40_000) return;
  lastWakeMs = Date.now();
  try {
    await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(15_000) });
  } catch {
    /* wake is best-effort */
  }
}

export async function dispatchBacktestToCloud(payload: {
  instrumentId: string;
  strategyIds: string[];
  widthSteps: number;
  months: number;
}): Promise<{ ok: boolean; error?: string }> {
  const base = cloudAppUrl();
  const secret = cloudWorkerSecret();
  if (!base) {
    return { ok: false, error: "Set CLOUD_APP_URL to your Railway app URL." };
  }
  if (!secret) {
    return {
      ok: false,
      error: "Set CLOUD_WORKER_SECRET on local .env and Railway.",
    };
  }

  try {
    await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(90_000) });
  } catch {
    /* serverless wake can 502 once; the run POST may still work */
  }

  try {
    const response = await fetch(`${base}/api/backtest-run`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-worker-secret": secret,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
    });
    const body = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
    };
    if (!response.ok || body.ok === false) {
      return {
        ok: false,
        error: body.error || `Cloud worker HTTP ${response.status}`,
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `Could not reach Railway (${error.message}). Is the service awake?`
          : "Could not reach Railway.",
    };
  }
}
