import type { Route } from "./+types/api.backtest-job";
import { isCloudBacktestClient, keepCloudAwake } from "../lib/lab/backtest-cloud";
import { jobForUi, peekBacktestJob, pullBacktestJob } from "../lib/lab/backtest-job";
import { bootSession } from "../lib/session.server";

export function shouldRevalidate() {
  return true;
}

export async function loader({ request }: Route.LoaderArgs) {
  await bootSession(request, "api");
  await pullBacktestJob();
  if (isCloudBacktestClient() && peekBacktestJob().status === "running") {
    void keepCloudAwake();
  }
  return Response.json(
    { job: jobForUi(peekBacktestJob()) },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
      },
    },
  );
}
