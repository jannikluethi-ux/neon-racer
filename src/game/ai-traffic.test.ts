import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scanTraffic, type TrafficState } from "./ai.ts";
import { buildTrack } from "./track.ts";
import type { CarState } from "./types.ts";

function stub(
  id: string,
  arc: number,
  latOff: number,
  forwardSpeed = 40,
): CarState {
  return { id, arc, latOff, forwardSpeed } as CarState;
}

function trafficFor(
  car: CarState,
  others: readonly CarState[],
): TrafficState {
  return scanTraffic(car, [car, ...others], buildTrack());
}

describe("AI traffic state isolation (AUD-001)", () => {
  it("returns independent traffic contexts for two cars", () => {
    const ego1 = stub("ego1", 100, 0, 45);
    const aheadRight = stub("aheadRight", 110, 4, 30);
    const t1 = trafficFor(ego1, [aheadRight]);
    assert.deepEqual(t1, { side: -1, defend: false, close: false });

    const ego2 = stub("ego2", 200, 0, 50);
    const behindLeft = stub("behindLeft", 195, -4, 50);
    const t2 = trafficFor(ego2, [behindLeft]);
    assert.deepEqual(t2, { side: 0, defend: true, close: false });
  });

  it("does not let a second evaluation mutate the first car's traffic state", () => {
    const ego1 = stub("ego1", 100, 0, 45);
    const aheadRight = stub("aheadRight", 110, 4, 30);
    const t1 = trafficFor(ego1, [aheadRight]);

    const ego2 = stub("ego2", 100, 0, 45);
    const behindLeft = stub("behindLeft", 95, -4, 50);
    const t2 = trafficFor(ego2, [behindLeft]);

    assert.notEqual(
      t1,
      t2,
      "each evaluation must return its own traffic-state object",
    );
    assert.deepEqual(t1, { side: -1, defend: false, close: false });
    assert.deepEqual(t2, { side: 0, defend: true, close: false });

    // If the implementation ever shared a mutable object, this would
    // corrupt t1 after the second scan.
    t2.side = 1;
    t2.defend = false;
    t2.close = true;
    assert.deepEqual(t1, { side: -1, defend: false, close: false });
  });

  it("produces equivalent traffic information regardless of evaluation order", () => {
    const egoA = stub("egoA", 100, 0, 45);
    const egoB = stub("egoB", 100, 0, 45);
    const right = stub("right", 110, 4, 30);
    const left = stub("left", 95, -4, 50);
    const cars = [egoA, egoB, right, left];
    const track = buildTrack();

    const aFirst = [
      scanTraffic(egoA, cars, track),
      scanTraffic(egoB, cars, track),
    ];
    const bFirst = [
      scanTraffic(egoB, cars, track),
      scanTraffic(egoA, cars, track),
    ];

    assert.deepEqual(aFirst[0], bFirst[1]);
    assert.deepEqual(aFirst[1], bFirst[0]);
  });

  it("reports no traffic when no relevant car is nearby", () => {
    const ego = stub("ego", 100, 0, 40);
    const farAhead = stub("farAhead", 130, 0, 40);
    const farBehind = stub("farBehind", 80, 0, 40);
    const t = trafficFor(ego, [farAhead, farBehind]);
    assert.deepEqual(t, { side: 0, defend: false, close: false });
  });

  it("detects a car approaching from the side ahead", () => {
    const ego = stub("ego", 100, 0, 40);
    const side = stub("side", 108, 5, 35);
    const t = trafficFor(ego, [side]);
    assert.equal(t.side, -1);
    assert.equal(t.defend, false);
    assert.equal(t.close, false);
  });

  it("detects a close car alongside", () => {
    const ego = stub("ego", 100, 0, 45);
    const alongside = stub("alongside", 105, 3, 40);
    const t = trafficFor(ego, [alongside]);
    assert.equal(t.side, -1);
    assert.equal(t.close, true);
    assert.equal(t.defend, false);
  });

  it("detects a defensive situation when a car is close behind", () => {
    const ego = stub("ego", 100, 0, 40);
    const chaser = stub("chaser", 92, 2, 48);
    const t = trafficFor(ego, [chaser]);
    assert.equal(t.defend, true);
    assert.equal(t.side, 0);
    assert.equal(t.close, false);
  });
});
