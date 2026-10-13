import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SimWallet,
  WALLET_START_INR,
  canAffordMargin,
  walletFromPaperTrades,
} from "./wallet";

describe("paper wallet", () => {
  it("starts at 1 lakh with nothing locked", () => {
    const wallet = walletFromPaperTrades([]);
    assert.equal(wallet.startInr, WALLET_START_INR);
    assert.equal(wallet.freeInr, 100_000);
    assert.equal(wallet.equityInr, 100_000);
  });

  it("locks open margin and books closed pnl", () => {
    const wallet = walletFromPaperTrades([
      { status: "closed", pnl_inr: 2_500 },
      { status: "open", margin_inr: 71_000, mark_pnl_inr: -400 },
    ]);
    assert.equal(wallet.realizedInr, 2_500);
    assert.equal(wallet.lockedInr, 71_000);
    assert.equal(wallet.freeInr, 31_500);
    assert.equal(wallet.equityInr, 102_100);
    assert.equal(canAffordMargin(wallet.freeInr, 71_000), false);
    assert.equal(canAffordMargin(wallet.freeInr, 3_000), true);
  });
});

describe("sim wallet", () => {
  it("skips a second iron condor while the first is still open", () => {
    const wallet = new SimWallet();
    const day = 20_000;
    assert.equal(
      wallet.tryOpen(day + 10 * 60, 71_000, day + 14 * 60, 800),
      true,
    );
    assert.equal(
      wallet.tryOpen(day + 10 * 60 + 30, 71_000, day + 15 * 60, 400),
      false,
    );
    assert.equal(
      wallet.tryOpen(day + 10 * 60 + 35, 2_200, day + 15 * 60 + 15, 150),
      true,
    );
    wallet.settle();
    assert.equal(wallet.skipped, 1);
    assert.equal(wallet.equityInr(), 100_000 + 800 + 150);
    assert.equal(wallet.peakLockedInr, 73_200);
  });

  it("frees margin at exit so the next day can enter", () => {
    const wallet = new SimWallet();
    const d1 = 20_000;
    const d2 = 40_000;
    assert.equal(wallet.tryOpen(d1 + 600, 71_000, d1 + 840, -1_200), true);
    assert.equal(wallet.tryOpen(d2 + 600, 71_000, d2 + 840, 900), true);
    wallet.settle();
    assert.equal(wallet.skipped, 0);
    assert.equal(wallet.equityInr(), 100_000 - 1_200 + 900);
  });
});
