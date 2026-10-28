import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { marginRequiredInr } from "./margin";

const SPOT = 22_698.85;

describe("marginRequiredInr", () => {
  it("uses Dhan Overall Margin for a naked 1-leg short", () => {
    const margin = marginRequiredInr({
      instrumentId: "NIFTY",
      credit: 227.9,
      width: 0,
      spot: SPOT,
      legCount: 1,
    });
    // Dhan 28 Oct 2026: Overall Margin ₹1,75,538.74
    assert.ok(Math.abs(margin - 175_539) < 200, `got ${margin}`);
  });

  it("uses Dhan Final Margin for a 2-leg PE credit spread", () => {
    const margin = marginRequiredInr({
      instrumentId: "NIFTY",
      credit: 8_326.5 / 65,
      width: 300,
      spot: SPOT,
      legCount: 2,
    });
    // Dhan 28 Oct 2026: Final Margin ₹55,411.59
    assert.ok(Math.abs(margin - 55_412) < 100, `got ${margin}`);
  });

  it("keeps 4-leg iron condors on the 4.4% SPAN proxy", () => {
    const margin = marginRequiredInr({
      instrumentId: "NIFTY",
      strategyId: "IRON_CONDOR",
      credit: 67.3,
      width: 200,
      spot: 22_721.5,
      legCount: 4,
    });
    assert.equal(Math.round(margin), 64_983);
  });
});
