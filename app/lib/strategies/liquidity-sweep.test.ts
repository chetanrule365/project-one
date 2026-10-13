import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectLiquiditySweep,
  sweepIsFresh,
  sweepSpreadSide,
  type SweepBar,
} from "./liquidity-sweep";

function bar(
  hour: number,
  minute: number,
  price: number,
  volume: number,
  wick?: { high?: number; low?: number },
): SweepBar {
  return {
    day: "2026-10-13",
    hour,
    minute,
    open: price,
    high: wick?.high ?? price,
    low: wick?.low ?? price,
    close: price,
    volume,
  };
}

const quiet = [100, 110, 90, 105, 95, 100];

describe("liquidity sweep", () => {
  it("fades a wick back through the prior low when volume is hot", () => {
    const bars = [
      ...quiet.map((volume, index) => bar(9, 15 + index * 5, 1000, volume)),
      bar(10, 5, 1005, 400, { low: 960, high: 1008 }),
    ];
    const signal = detectLiquiditySweep({
      bars,
      priorHigh: 1020,
      priorLow: 990,
      putOi: null,
      callOi: null,
      buffer: 20,
    });
    assert.equal(signal?.kind, "trap-down");
    assert.equal(signal?.levelName, "prior low");
    assert.ok(sweepIsFresh(signal!, 10, 15));
    assert.equal(sweepIsFresh(signal!, 10, 25), false);
  });

  it("sits out a held break instead of riding it", () => {
    const bars = [
      ...quiet.map((volume, index) => bar(9, 15 + index * 5, 1000, volume)),
      bar(10, 0, 1045, 400),
      bar(10, 5, 1050, 400),
      bar(10, 10, 1055, 420),
      bar(10, 15, 1060, 430),
    ];
    const signal = detectLiquiditySweep({
      bars,
      priorHigh: 1020,
      priorLow: 980,
      putOi: null,
      callOi: null,
      buffer: 20,
    });
    assert.equal(signal, null);
  });

  it("does not treat three closes outside as a held break", () => {
    const bars = [
      ...quiet.map((volume, index) => bar(9, 15 + index * 5, 1000, volume)),
      bar(10, 0, 1045, 400),
      bar(10, 5, 1050, 400),
      bar(10, 10, 1055, 420),
    ];
    const signal = detectLiquiditySweep({
      bars,
      priorHigh: 1020,
      priorLow: 980,
      putOi: null,
      callOi: null,
      buffer: 20,
    });
    assert.equal(signal, null);
  });

  it("can still fade the other side after a held break", () => {
    const bars = [
      ...quiet.map((volume, index) => bar(9, 15 + index * 5, 1000, volume)),
      bar(10, 0, 1045, 400),
      bar(10, 5, 1050, 400),
      bar(10, 10, 1055, 420),
      bar(10, 15, 1060, 430),
      bar(11, 0, 1005, 400, { low: 960, high: 1008 }),
    ];
    const signal = detectLiquiditySweep({
      bars,
      priorHigh: 1020,
      priorLow: 990,
      putOi: null,
      callOi: null,
      buffer: 20,
    });
    assert.equal(signal?.kind, "trap-down");
    assert.equal(signal?.levelName, "prior low");
  });

  it("does not ride an opening-range hold", () => {
    const bars = [
      ...quiet.map((volume, index) => bar(9, 15 + index * 5, 1000, volume)),
      bar(10, 0, 1035, 400),
      bar(10, 5, 1040, 400),
      bar(10, 10, 1045, 420),
      bar(10, 15, 1050, 430),
    ];
    const signal = detectLiquiditySweep({
      bars,
      priorHigh: 1100,
      priorLow: 900,
      putOi: null,
      callOi: null,
      buffer: 20,
    });
    assert.equal(signal, null);
  });

  it("still fades a failed opening-range break", () => {
    const bars = [
      ...quiet.map((volume, index) => bar(9, 15 + index * 5, 1000, volume)),
      bar(10, 5, 995, 400, { high: 1035 }),
    ];
    const signal = detectLiquiditySweep({
      bars,
      priorHigh: 1100,
      priorLow: 900,
      putOi: null,
      callOi: null,
      buffer: 20,
    });
    assert.equal(signal?.kind, "trap-up");
    assert.equal(signal?.levelName, "opening high");
  });

  it("ignores OI walls even when they wick on hot volume", () => {
    const bars = [
      ...quiet.map((volume, index) => bar(9, 15 + index * 5, 1000, volume)),
      bar(10, 5, 1002, 400, { high: 1035 }),
    ];
    const signal = detectLiquiditySweep({
      bars,
      priorHigh: 1100,
      priorLow: 900,
      putOi: 980,
      callOi: 1010,
      buffer: 20,
    });
    assert.equal(signal, null);
  });

  it("sells puts on trap-down and accept-up, calls on trap-up and accept-down", () => {
    assert.equal(sweepSpreadSide("trap-down"), "down");
    assert.equal(sweepSpreadSide("accept-up"), "down");
    assert.equal(sweepSpreadSide("trap-up"), "up");
    assert.equal(sweepSpreadSide("accept-down"), "up");
  });

  it("keeps watching after 10:00 and uses the later morning trap", () => {
    const bars = [
      ...quiet.map((volume, index) => bar(9, 15 + index * 5, 1000, volume)),
      bar(10, 5, 1005, 400, { low: 960, high: 1008 }),
      bar(11, 0, 1004, 400, { low: 955, high: 1006 }),
    ];
    const signal = detectLiquiditySweep({
      bars,
      priorHigh: 1020,
      priorLow: 990,
      putOi: null,
      callOi: null,
      buffer: 20,
      pick: "latest",
    });
    assert.equal(signal?.kind, "trap-down");
    assert.equal(signal?.hour, 11);
    assert.ok(sweepIsFresh(signal!, 11, 10));
  });

  it("ignores afternoon sweep events", () => {
    const bars = [
      ...quiet.map((volume, index) => bar(9, 15 + index * 5, 1000, volume)),
      bar(14, 0, 1004, 400, { low: 955, high: 1006 }),
    ];
    const signal = detectLiquiditySweep({
      bars,
      priorHigh: 1020,
      priorLow: 990,
      putOi: null,
      callOi: null,
      buffer: 20,
      pick: "latest",
    });
    assert.equal(signal, null);
  });

  it("ignores a wick when volume is ordinary", () => {
    const bars = [
      ...quiet.map((volume, index) => bar(9, 15 + index * 5, 1000, volume)),
      bar(10, 5, 1005, 100, { low: 960 }),
    ];
    const signal = detectLiquiditySweep({
      bars,
      priorHigh: 1020,
      priorLow: 990,
      putOi: null,
      callOi: null,
      buffer: 20,
    });
    assert.equal(signal, null);
  });
});
