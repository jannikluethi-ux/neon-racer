import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evalTires, gripShape, lateralShape, type TireRequest } from "./tires.ts";
import { VECTOR } from "./vehicle-def.ts";

function request(overrides: Partial<TireRequest> = {}): TireRequest {
  return {
    forward: 20,
    lateral: 0,
    yawRate: 0,
    steer: 0,
    steerSens: 1,
    driveDemand: 8,
    brakeDemand: 0,
    boostBlend: 0,
    airborne: false,
    longSlip: 0,
    longAccel: 0,
    latAccel: 0,
    lift: 0,
    handbrake: false,
    dt: 1 / 60,
    ...overrides,
  };
}

describe("tyre system", () => {
  it("shapes peak at slip = 1 and decline after the peak", () => {
    assert.equal(gripShape(0), 0);
    assert.equal(gripShape(1), 1);
    assert.ok(gripShape(2) < gripShape(1));
    assert.ok(gripShape(2) > 0);

    assert.equal(lateralShape(0), 0);
    assert.equal(lateralShape(1), 1);
    assert.ok(lateralShape(2) < lateralShape(1));
  });

  it("returns finite forces for a typical request", () => {
    const result = evalTires(request(), VECTOR);
    assert.ok(Number.isFinite(result.drive));
    assert.ok(Number.isFinite(result.lat));
    assert.ok(Number.isFinite(result.yawAccel));
    assert.ok(Number.isFinite(result.frontLoad));
    assert.ok(Number.isFinite(result.rearLoad));
  });

  it("keeps front and rear load summed to one", () => {
    const result = evalTires(request({ longAccel: 5 }), VECTOR);
    assert.equal(result.frontLoad + result.rearLoad, 1);
  });

  it("produces wheelspin when longitudinal slip is high", () => {
    const low = evalTires(request({ driveDemand: 2 }), VECTOR);
    assert.equal(low.wheelspin, 0);

    // Spin the tyre model up under heavy demand; slip relaxes toward the limit.
    let longSlip = 0;
    let result = low;
    for (let i = 0; i < 40; i++) {
      result = evalTires(request({ driveDemand: 80, longSlip }), VECTOR);
      longSlip = result.longSlip;
      if (longSlip > 1) break;
    }
    assert.ok(result.wheelspin > 0, `wheelspin should be positive at slip ${result.longSlip}`);
  });

  it("does not leak state between evaluations", () => {
    const first = evalTires(request({ driveDemand: 40, steer: 0.5 }), VECTOR);
    const snapshot = { ...first };
    evalTires(request({ driveDemand: 2, steer: 0 }), VECTOR);
    assert.deepEqual(first, snapshot);
  });

  it("responds to airborne loss of grip", () => {
    const ground = evalTires(request(), VECTOR);
    const air = evalTires(request({ airborne: true }), VECTOR);
    assert.ok(air.frontUse <= ground.frontUse + 1e-6);
    assert.ok(air.rearUse <= ground.rearUse + 1e-6);
  });
});
