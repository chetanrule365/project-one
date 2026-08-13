import { proposalSummary } from "../app/lib/strategies/common";
import {
  formatPaperLegs,
  pnlLooksBroken,
  settleTradePoints,
} from "../app/lib/lab/paper-position";
import type { PaperTrade } from "../app/lib/lab/paper-store";

const orb: PaperTrade = {
  id: 1,
  run_id: 1,
  strategy_id: "ORB_ATM",
  status: "closed",
  short_strike: 0,
  long_strike: 77800,
  short_side: "CE",
  long_side: "PE",
  credit: -127.9,
  width: 50,
  spot_entry: 77815.4,
  spot_exit: 77892.5,
  pnl_points: 77764.6,
  pnl_inr: 1555292,
  entry_at: "2026-08-13",
  expiry_at: "2026-08-13",
  exit_at: "2026-08-13T08:30:00.000Z",
};

const pnl = settleTradePoints(orb, orb.spot_exit ?? 0);
const summary = proposalSummary([
  { right: "PE", strike: 77800, strikeKey: "ATM", qty: 1, premium: 127.9 },
]);

const checks = [
  formatPaperLegs(orb) === "B 77800 PE",
  Math.abs(pnl - -127.9) < 0.01,
  pnlLooksBroken(77764.6, -127.9, 77892.5, pnl),
  !pnlLooksBroken(-127.9, -127.9, 77892.5, pnl),
  summary.width === 0,
  summary.primaryShortStrike === 0,
  summary.primaryLongStrike === 77800,
  summary.primaryLongSide === "PE",
];

if (checks.some((ok) => !ok)) {
  console.error("paper-position checks failed", { checks, pnl, summary });
  process.exit(1);
}

console.log("paper-position ok", { pnl: Number(pnl.toFixed(2)) });
