import { decidePaperExit } from "../app/lib/lab/paper-exit";
import {
  buildLiveDayStructure,
  normalizeExpiryDay,
  priorSessionFromSessions,
  sessionsFromChartArrays,
} from "../app/lib/strategies/expiry-day";
import { positionDefaults } from "../app/lib/strategies/registry";

const legacyDaily = decidePaperExit({
  strategyId: "IRON_CONDOR",
  hour: 14,
  today: "2026-08-14",
  expiryAt: "2026-08-14",
  expirySession: false,
  credit: 157.4,
  pnlPoints: -0.7,
  entryHour: 10,
});

const icHold = decidePaperExit({
  strategyId: "IRON_CONDOR",
  hour: 14,
  today: "2026-08-14",
  expiryAt: "2026-08-18",
  credit: 153.1,
  pnlPoints: -0.9,
  entryHour: 10,
});

const icFlat = decidePaperExit({
  strategyId: "IRON_CONDOR",
  hour: 15,
  today: "2026-08-14",
  expiryAt: "2026-08-18",
  credit: 153.1,
  pnlPoints: 40,
  entryHour: 10,
});

const icExpiry = decidePaperExit({
  strategyId: "IRON_CONDOR",
  hour: 14,
  today: "2026-08-13",
  expiryAt: "2026-08-13",
  credit: 44.7,
  pnlPoints: 44.7,
  entryHour: 13,
});

const tp = decidePaperExit({
  strategyId: "OI_RANGE_FADE",
  hour: 12,
  today: "2026-08-14",
  expiryAt: "2026-08-18",
  credit: 23.05,
  pnlPoints: 14,
  entryHour: 10,
});

const noTpYet = decidePaperExit({
  strategyId: "OI_RANGE_FADE",
  hour: 12,
  today: "2026-08-14",
  expiryAt: "2026-08-18",
  credit: 23.05,
  pnlPoints: 10.4,
  entryHour: 10,
});

const sessions = sessionsFromChartArrays(
  undefined,
  [100, 110],
  [102, 112],
  [99, 108],
  [101, 111],
);
const prior = priorSessionFromSessions(sessions, "2026-08-14");

const live = buildLiveDayStructure({
  day: "2026-08-14",
  spot: 24350,
  instrumentId: "NIFTY",
  maxPain: null,
  putOiSupport: 24250,
  callOiResistance: 24500,
  quote: { open: 24320, high: 24390, low: 24300, prevClose: 24280 },
  prior: { high: 24400, low: 24100, close: 24280 },
});

const gapped = buildLiveDayStructure({
  day: "2026-08-14",
  spot: 25000,
  instrumentId: "NIFTY",
  maxPain: null,
  putOiSupport: null,
  callOiResistance: null,
  quote: { open: 25000, high: 25100, low: 24950, prevClose: 24300 },
  prior: { high: 24400, low: 24100, close: 24300 },
});

const checks = [
  icHold === null,
  legacyDaily === null,
  icFlat?.reason === "Flat by 15:00",
  icExpiry?.reason === "Flat by 14:00",
  tp?.reason === "Take profit 60%",
  noTpYet === null,
  positionDefaults("IRON_CONDOR", false).flatByHour === 15,
  positionDefaults("IRON_CONDOR", true).flatByHour === 14,
  normalizeExpiryDay("18-08-2026") === "2026-08-18",
  prior?.high === 102,
  live.insidePriorRange === true,
  gapped.insidePriorRange === false,
];

if (checks.some((ok) => !ok)) {
  console.error("paper-exit checks failed", {
    checks,
    icHold,
    icFlat,
    icExpiry,
    tp,
    noTpYet,
    live: live.insidePriorRange,
    gapped: gapped.insidePriorRange,
    prior,
  });
  process.exit(1);
}

console.log("paper-exit ok");
