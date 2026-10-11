import { hydrateAuthStore } from "../dhan/auth";
import { startOptionCacheSync } from "../dhan/rolling-options";
import { hydrateBacktestJob } from "../lab/backtest-job";
import { hydrateBacktestStore } from "../lab/backtest-store";
import { hydratePaperStore } from "../lab/paper-store";
import { isMongoConfigured } from "../mongo";

let boot: Promise<void> | null = null;

/** Pull paper / backtests / job / Dhan auth from MongoDB, then keep dual-writing. */
export function bootCloudStores() {
  if (boot) return boot;
  boot = (async () => {
    if (isMongoConfigured()) {
      console.log("[mongo] hydrating stores");
    }
    await Promise.all([
      hydratePaperStore(),
      hydrateBacktestStore(),
      hydrateBacktestJob(),
      hydrateAuthStore(),
    ]);
    startOptionCacheSync();
  })().catch((error) => {
    boot = null;
    console.error("[mongo] store hydrate failed", error);
  });
  return boot;
}
