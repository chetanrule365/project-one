import { INDEX_INSTRUMENTS } from "../app/lib/dhan/instruments";
import { applyLiveQuoteStructure, orbFightsMaxPain } from "../app/lib/strategies/expiry-day";
import { orbAtmStrategy } from "../app/lib/strategies/orb-atm";
import { pickExpiryPath } from "../app/lib/strategies/registry";
import type { DayStructure, EntryContext } from "../app/lib/strategies/types";

const sensex = INDEX_INSTRUMENTS.find((i) => i.id === "SENSEX")!;

function structure(partial: Partial<DayStructure>): DayStructure {
  return {
    day: "2026-08-13",
    spot: 77815,
    open: 78050,
    priorHigh: 78200,
    priorLow: 77600,
    priorClose: 77900,
    morningHigh: 78050,
    morningLow: 77800,
    orbBrokenUp: false,
    orbBrokenDown: true,
    quietDay: false,
    insidePriorRange: true,
    maxPain: 78000,
    putOiSupport: 77600,
    callOiResistance: 78200,
    distToMaxPain: 77815 - 78000,
    ...partial,
  };
}

function ctx(partial: Partial<EntryContext> = {}): EntryContext {
  return {
    instrument: sensex,
    spot: 77815,
    widthSteps: 2,
    hour: 10,
    structure: structure({}),
    premiums: { "ATM:PE": 127.9, "ATM:CE": 80 },
    strikes: { ATM: 77800 },
    ...partial,
  };
}

const todayLike = applyLiveQuoteStructure(
  structure({ orbBrokenDown: false, quietDay: false }),
  { open: 78050, high: 78050, low: 77800, prevClose: 77900 },
  77815,
  "SENSEX",
);

const checks = [
  !orbAtmStrategy.isEligible(ctx({ structure: structure({ quietDay: true }) })),
  !orbAtmStrategy.isEligible(ctx({ hour: 12 })),
  !orbAtmStrategy.isEligible(
    ctx({
      structure: structure({ distToMaxPain: -200, maxPain: 78000 }),
    }),
  ),
  orbAtmStrategy.proposeEntry(ctx()) === null,
  todayLike.orbBrokenDown === false,
  orbFightsMaxPain(structure({ distToMaxPain: -185 }), "down") === true,
  pickExpiryPath(
    ctx({
      structure: structure({
        orbBrokenDown: true,
        quietDay: true,
      }),
    }),
    ["ORB_ATM"],
  ) === null,
];

if (checks.some((ok) => !ok)) {
  console.error("strategy-filters failed", checks, {
    todayLike,
    proposal: orbAtmStrategy.proposeEntry(ctx()),
  });
  process.exit(1);
}

console.log("strategy-filters ok");
