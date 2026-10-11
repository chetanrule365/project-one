import { jobForUi, peekBacktestJob } from "./backtest-job";

/** JSON for the live-status HTTP endpoint (not a React Router route). */
export function jobStatusPayload() {
  return { job: jobForUi(peekBacktestJob()) };
}
