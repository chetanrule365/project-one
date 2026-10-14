import type { Route } from "./+types/api.backtest-run";
import { getIndexByParam } from "../lib/dhan/instruments";
import { bootCloudStores } from "../lib/store/boot.server";
import {
  cloudWorkerSecret,
  isCloudRuntime,
} from "../lib/lab/backtest-cloud";
import { startBacktestJob } from "../lib/lab/backtest-job.server";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "Method not allowed" }, { status: 405 });
  }

  const expected = cloudWorkerSecret();
  const got = request.headers.get("x-worker-secret")?.trim() ?? "";
  if (!expected || got !== expected) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  await bootCloudStores();

  if (!isCloudRuntime()) {
    return Response.json(
      {
        ok: false,
        error: "This instance is not the cloud worker.",
      },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    instrumentId?: string;
    strategyIds?: string[];
    widthSteps?: number;
    months?: number;
  } | null;

  const instrument = getIndexByParam(String(body?.instrumentId ?? ""));
  const strategyIds = Array.isArray(body?.strategyIds)
    ? body.strategyIds.map(String)
    : [];
  if (!instrument || strategyIds.length === 0) {
    return Response.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const started = await startBacktestJob({
    instrument,
    strategyIds,
    widthSteps: Number(body?.widthSteps ?? 2),
    months: Number(body?.months ?? 6),
  });
  return Response.json(started, { status: started.ok ? 200 : 409 });
}
