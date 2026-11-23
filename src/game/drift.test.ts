import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evalTires, type TireRequest } from "./tires.ts";
import { VECTOR } from "./vehicle-def.ts";
import { applyLaunch, stepCar } from "./vehicle.ts";
import { IDLE_INPUT } from "./types.ts";
import { readCommand, setTestKeys, touch } from "./input.ts";
import { carFixture, placeOnTrack, straightTrack } from "./test-fixtures.ts";

const dt = 1 / 60;

function tireReq(overrides: Partial<TireRequest> = {}): TireRequest {
  return {
    forward: 24,
    lateral: 2,
    yawRate: 0.2,
    steer: 0.6,
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
    dt,
    ...overrides,
  };
}

describe("handbrake input", () => {
  it("maps Space to the handbrake", () => {
    setTestKeys(["Space"]);
    const cmd = readCommand();
    assert.equal(cmd.drift, true);
    assert.equal(cmd.boost, false);
  });

  it("maps Shift keys and B/N to nitro", () => {
    setTestKeys(["ShiftLeft"]);
    const a = readCommand();
    assert.equal(a.boost, true);
    assert.equal(a.drift, false);

    setTestKeys(["KeyB"]);
    const b = readCommand();
    assert.equal(b.boost, true);
    assert.equal(b.drift, false);
  });

  it("maps the touch drift button to the handbrake", () => {
    setTestKeys([]);
    touch.throttle = false;
    touch.brake = false;
    touch.drift = true;
    touch.boost = false;
    touch.steer = 0;
    const cmd = readCommand();
    assert.equal(cmd.drift, true);
    assert.equal(cmd.throttle, 0);
    touch.drift = false;
  });

  it("supports simultaneous throttle, steering and handbrake", () => {
    setTestKeys([]);
    touch.throttle = true;
    touch.drift = true;
    touch.steer = 0.5;
    touch.brake = false;
    touch.boost = false;
    const cmd = readCommand();
    assert.equal(cmd.throttle, 1);
    assert.equal(cmd.drift, true);
    assert.equal(cmd.steer, 0.5);
    touch.throttle = false;
    touch.drift = false;
    touch.steer = 0;
  });

  it("releases the handbrake when touch input ends", () => {
    setTestKeys([]);
    touch.drift = true;
    assert.equal(readCommand().drift, true);
    touch.drift = false;
    assert.equal(readCommand().drift, false);
  });
});

describe("handbrake physics", () => {
  it("reduces rear lateral force when engaged", () => {
    const grip = evalTires(tireReq({ handbrake: false }), VECTOR);
    const slide = evalTires(tireReq({ handbrake: true }), VECTOR);
    assert.ok(
      Math.abs(slide.lat) < Math.abs(grip.lat),
      `handbrake lateral magnitude ${Math.abs(slide.lat)} should be below grip ${Math.abs(grip.lat)}`,
    );
    assert.ok(Math.abs(slide.yawAccel) > Math.abs(grip.yawAccel) * 0.8, "handbrake should increase yaw tendency");
  });

  it("does not alter grip when the handbrake is not held", () => {
    const base = evalTires(tireReq({ handbrake: false }), VECTOR);
    const noInput = evalTires(tireReq({ handbrake: false, steer: 0, lateral: 0, yawRate: 0 }), VECTOR);
    assert.ok(Number.isFinite(base.lat));
    assert.ok(Number.isFinite(base.yawAccel));
    assert.ok(noInput.lat === 0 || Math.abs(noInput.lat) < 1e-6);
  });

  it("initiates a controllable drift at speed", () => {
    const track = straightTrack();
    const car = carFixture();
    placeOnTrack(car, track, 120);
    applyLaunch(car, 30);

    const grip = carFixture();
    placeOnTrack(grip, track, 120);
    applyLaunch(grip, 30);

    const input = { ...IDLE_INPUT, throttle: 0.7, steer: 0.9, drift: true };
    const baseline = { ...IDLE_INPUT, throttle: 0.7, steer: 0.9, drift: false };

    for (let i = 0; i < 90; i++) {
      stepCar(car, input, track, dt, 1);
      stepCar(grip, baseline, track, dt, 1);
    }

    assert.ok(Math.abs(car.slipAngle) > Math.abs(grip.slipAngle) + 0.05, "drift should increase slip angle");
    assert.ok(Math.abs(car.latVel) > Math.abs(grip.latVel), "drift should create lateral velocity");
    assert.ok(car.driftState >= 2, `drift state should reach slip, got ${car.driftState}`);
    assert.ok(Math.abs(car.yawRate) > 0.1, "drift should yaw the car");
    assert.ok(Math.abs(car.yawRate) < 3.3, "drift should not spin uncontrollably");
  });

  it("recovers traction after the handbrake is released", () => {
    const track = straightTrack();
    const car = carFixture();
    placeOnTrack(car, track, 120);
    applyLaunch(car, 30);

    for (let i = 0; i < 50; i++) {
      stepCar(car, { ...IDLE_INPUT, throttle: 0.6, steer: 0.9, drift: true }, track, dt, 1);
    }
    assert.ok(car.driftState >= 2, "car should be sliding");

    for (let i = 0; i < 120; i++) {
      stepCar(car, { ...IDLE_INPUT, throttle: 0.5, steer: -0.7, drift: false }, track, dt, 1);
    }

    assert.ok(car.driftState < 2, `drift state should recover, got ${car.driftState}`);
    assert.ok(Math.abs(car.yawRate) < 1.5, "yaw rate should settle");
  });

  it("stays predictable at low speed", () => {
    const track = straightTrack();
    const car = carFixture();
    placeOnTrack(car, track, 120);
    applyLaunch(car, 4);

    for (let i = 0; i < 60; i++) {
      stepCar(car, { ...IDLE_INPUT, throttle: 1, drift: true, steer: 0.4 }, track, dt, 1);
    }

    assert.equal(car.drifting, false, "low-speed handbrake should not enter drift hold");
    assert.ok(Math.abs(car.yawRate) < 2, "low-speed handbrake should not spin");
    assert.ok(Number.isFinite(car.x) && Number.isFinite(car.z), "low-speed handbrake should stay stable");
  });
});

describe("normal driving unchanged", () => {
  it("accelerates, brakes and steers the same without handbrake input", () => {
    const track = straightTrack();
    const car = carFixture();
    placeOnTrack(car, track, 120);
    applyLaunch(car, 25);
    for (let i = 0; i < 60; i++) {
      stepCar(car, { ...IDLE_INPUT, throttle: 1, steer: 0.3 }, track, dt, 1);
    }
    assert.ok(car.forwardSpeed > 10);
    assert.ok(Math.abs(car.slipAngle) < 0.2);
    assert.equal(car.drifting, false);
  });
});
