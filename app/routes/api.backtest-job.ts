import type { Route } from "./+types/api.backtest-job";
import { isCloudBacktestClient, keepCloudAwake } from "../lib/lab/backtest-cloud";
import { getBacktestJob, jobForUi, pullBacktestJob } from "../lib/lab/backtest-job.server";
import { bootSession } from "../lib/session.server";

export function shouldRevalidate() {
  return true;
}

export async function loader({ request }: Route.LoaderArgs) {
  await bootSession(request, "api");
  await pullBacktestJob();
  const job = getBacktestJob();
  if (isCloudBacktestClient() && job.status === "running") {
    void keepCloudAwake();
  }
  return Response.json(
    { job: jobForUi(job) },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
      },
    },
  );
}
