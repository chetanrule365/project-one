import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  daysToExpiry,
  isExpiryCalendarDay,
  isExpirySession,
  lastTuesdayOfMonth,
  nextExpiryDateIst,
  scheduledExpiryOnOrAfter,
} from "./expiry-day";

describe("Bank Nifty monthly expiry", () => {
  it("uses last Tuesday of the month", () => {
    assert.equal(lastTuesdayOfMonth(2025, 10), "2025-10-28");
    assert.equal(lastTuesdayOfMonth(2025, 11), "2025-11-25");
    assert.equal(lastTuesdayOfMonth(2026, 3), "2026-03-31");
    assert.equal(lastTuesdayOfMonth(2026, 6), "2026-06-30");
    assert.equal(lastTuesdayOfMonth(2026, 8), "2026-08-25");
    assert.equal(lastTuesdayOfMonth(2026, 10), "2026-10-27");
  });

  it("does not treat every Tuesday as expiry", () => {
    assert.equal(isExpiryCalendarDay("BANKNIFTY", "2026-03-24"), false);
    assert.equal(isExpiryCalendarDay("BANKNIFTY", "2026-03-31"), true);
    assert.equal(isExpiryCalendarDay("NIFTY", "2026-03-24"), true);
    assert.equal(isExpiryCalendarDay("NIFTY", "2026-03-31"), true);
  });

  it("counts dte to last Tuesday, then next month", () => {
    assert.equal(daysToExpiry("BANKNIFTY", "2026-06-30"), 0);
    assert.equal(daysToExpiry("BANKNIFTY", "2026-06-29"), 1);
    assert.equal(daysToExpiry("BANKNIFTY", "2026-06-23"), 7);
    assert.equal(daysToExpiry("BANKNIFTY", "2026-07-01"), 27);
    assert.equal(nextExpiryDateIst("BANKNIFTY", "2026-07-01"), "2026-07-28");
  });

  it("shifts monthly expiry to the previous session when last Tuesday is missing", () => {
    const days = ["2026-03-27", "2026-03-30", "2026-04-01"];
    assert.equal(isExpirySession("BANKNIFTY", "2026-03-31", days), false);
    assert.equal(isExpirySession("BANKNIFTY", "2026-03-30", days), true);
    assert.equal(isExpirySession("BANKNIFTY", "2026-03-27", days), false);
  });

  it("keeps Nifty weekly Tuesday and Sensex Thursday", () => {
    assert.equal(scheduledExpiryOnOrAfter("NIFTY", "2026-10-11"), "2026-10-13");
    assert.equal(scheduledExpiryOnOrAfter("SENSEX", "2026-10-11"), "2026-10-15");
    assert.equal(daysToExpiry("NIFTY", "2026-10-12"), 1);
    assert.equal(daysToExpiry("SENSEX", "2026-10-15"), 0);
  });
});
