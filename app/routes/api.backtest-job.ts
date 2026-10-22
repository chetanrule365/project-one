import type { Route } from "./+types/api.backtest-job";
import { isCloudBacktestClient, keepCloudAwake } from "../lib/lab/backtest-cloud";
import { getBacktestJob, jobForUi, pullBacktestJob } from "../lib/lab/backtest-job.server";
import { isDemoRequest } from "../lib/demo.server";
import { demoBacktestJob } from "../lib/lab/demo-data.server";
import { bootSession } from "../lib/session.server";

export function shouldRevalidate() {
  return true;
}

export async function loader({ request }: Route.LoaderArgs) {
  await bootSession(request, "api");
  if (isDemoRequest(request)) {
    return Response.json(
      { job: demoBacktestJob() },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
          Pragma: "no-cache",
        },
      },
    );
  }
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
