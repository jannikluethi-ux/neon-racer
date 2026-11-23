import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyLaunch, stepCar } from "./vehicle.ts";
import { IDLE_INPUT } from "./types.ts";
import { carFixture, placeOnTrack, straightTrack } from "./test-fixtures.ts";

const dt = 1 / 60;

describe("vehicle system", () => {
  it("initializes a car with applyLaunch", () => {
    const car = carFixture();
    applyLaunch(car, 25);
    assert.equal(car.forwardSpeed, 25);
    assert.ok(car.gear > 0 || car.rpm > 0.3);
    assert.equal(car.driftState, 0);
    assert.equal(car.drifting, false);
    assert.equal(car.slipAngle, 0);
    assert.equal(car.latVel, 0);
  });

  it("accelerates when throttle is applied", () => {
    const track = straightTrack();
    const car = carFixture();
    placeOnTrack(car, track, 120);
    applyLaunch(car, 0);
    for (let i = 0; i < 60; i++) {
      stepCar(car, { ...IDLE_INPUT, throttle: 1 }, track, dt, 1);
    }
    assert.ok(car.forwardSpeed > 5);
    assert.ok(car.raceDist > 0);
  });

  it("clamps forward speed to the vehicle safety speed", () => {
    const track = straightTrack();
    const car = carFixture();
    placeOnTrack(car, track, 120);
    applyLaunch(car, 90);
    stepCar(car, { ...IDLE_INPUT, throttle: 1 }, track, dt, 1);
    assert.ok(car.forwardSpeed <= 70 + 1e-6);
  });

  it("clamps reverse speed", () => {
    const track = straightTrack();
    const car = carFixture();
    placeOnTrack(car, track, 120);
    applyLaunch(car, -20);
    stepCar(car, { ...IDLE_INPUT, throttle: 0, brake: 1 }, track, dt, 1);
    assert.ok(car.forwardSpeed >= -17);
  });

  it("handles out-of-range inputs without producing NaN", () => {
    const track = straightTrack();
    const car = carFixture();
    placeOnTrack(car, track, 120);
    applyLaunch(car, 20);
    stepCar(
      car,
      { throttle: 2, brake: -1, steer: 3, drift: false, boost: true },
      track,
      dt,
      1,
    );
    assert.ok(Number.isFinite(car.x));
    assert.ok(Number.isFinite(car.z));
    assert.ok(Number.isFinite(car.forwardSpeed));
    assert.ok(Number.isFinite(car.yaw));
  });

  it("upshifts under sustained throttle", () => {
    const track = straightTrack();
    const car = carFixture();
    placeOnTrack(car, track, 120);
    applyLaunch(car, 25);
    const startGear = car.gear;
    for (let i = 0; i < 8 * 60; i++) {
      stepCar(car, { ...IDLE_INPUT, throttle: 1 }, track, dt, 1);
    }
    assert.ok(car.gear > startGear);
  });

  it("brings the car to a stop with full brake", () => {
    const track = straightTrack();
    const car = carFixture();
    placeOnTrack(car, track, 120);
    applyLaunch(car, 30);
    for (let i = 0; i < 4 * 60; i++) {
      stepCar(car, { ...IDLE_INPUT, brake: 1 }, track, dt, 1);
      if (car.forwardSpeed < 0.5) break;
    }
    assert.ok(car.forwardSpeed < 1);
  });

  it("steering input produces yaw change", () => {
    const track = straightTrack();
    const car = carFixture();
    placeOnTrack(car, track, 120);
    applyLaunch(car, 22);
    const yaw0 = car.yaw;
    for (let i = 0; i < 60; i++) {
      stepCar(car, { ...IDLE_INPUT, throttle: 0.5, steer: 1 }, track, dt, 1);
    }
    assert.notEqual(car.yaw, yaw0);
    assert.ok(Math.abs(car.yaw - yaw0) > 0.01);
  });
});
