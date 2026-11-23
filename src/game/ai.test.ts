import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { aiCommand, scanTraffic } from "./ai.ts";
import { AI_CARS } from "./tuning.ts";
import { carFixture, placeOnTrack, straightTrack } from "./test-fixtures.ts";

const dt = 1 / 60;

function readyCar(overrides: Parameters<typeof carFixture>[0] = {}) {
  const car = carFixture({
    ai: AI_CARS[0]!,
    isPlayer: false,
    vehicleId: "vector",
    forwardSpeed: 40,
    ...overrides,
  });
  const track = straightTrack();
  placeOnTrack(car, track, 120);
  car.aiSteer = 0;
  car.stuck = 0;
  car.slipAngle = 0;
  car.boostEnergy = 1;
  car.boostLock = 0;
  return { car, track };
}

describe("AI system", () => {
  it("produces a finite command on a straight track with no opponents", () => {
    const { car, track } = readyCar();
    const cmd = aiCommand(car, track, dt, [car], "normal", 10);
    assert.ok(Number.isFinite(cmd.throttle));
    assert.ok(Number.isFinite(cmd.brake));
    assert.ok(Number.isFinite(cmd.steer));
    assert.equal(typeof cmd.boost, "boolean");
    assert.ok(cmd.throttle >= 0 && cmd.throttle <= 1);
    assert.ok(cmd.brake >= 0 && cmd.brake <= 1);
  });

  it("is deterministic for identical state", () => {
    const { car, track } = readyCar();
    const a = aiCommand(car, track, dt, [car], "normal", 10);
    car.aiSteer = 0;
    const b = aiCommand(car, track, dt, [car], "normal", 10);
    assert.equal(a.throttle, b.throttle);
    assert.equal(a.brake, b.brake);
    assert.equal(a.boost, b.boost);
    assert.equal(a.steer, b.steer);
  });

  it("enters OVERTAKE when a car is ahead to the side", () => {
    const { car: ego, track } = readyCar();
    const opponent = carFixture({
      id: "opp",
      isPlayer: false,
      ai: AI_CARS[1]!,
      vehicleId: "vanta",
      latOff: 4,
      forwardSpeed: 30,
    });
    placeOnTrack(opponent, track, 120);
    opponent.arc = ego.arc + 8;
    aiCommand(ego, track, dt, [ego, opponent], "normal", 10);
    assert.equal(ego.aiState, "OVERTAKE");
  });

  it("enters DEFEND when a car is close behind", () => {
    const { car: ego, track } = readyCar();
    const opponent = carFixture({
      id: "opp",
      isPlayer: false,
      ai: AI_CARS[1]!,
      vehicleId: "vanta",
      latOff: 0,
      forwardSpeed: 50,
    });
    placeOnTrack(opponent, track, 120);
    opponent.arc = ego.arc - 8;
    aiCommand(ego, track, dt, [ego, opponent], "normal", 10);
    assert.equal(ego.aiState, "DEFEND");
  });

  it("ignores distant opponents", () => {
    const { car: ego, track } = readyCar();
    const opponent = carFixture({
      id: "opp",
      isPlayer: false,
      ai: AI_CARS[1]!,
      vehicleId: "vanta",
      latOff: 0,
      forwardSpeed: 50,
    });
    placeOnTrack(opponent, track, 300);
    const t = scanTraffic(ego, [ego, opponent], track);
    assert.deepEqual(t, { side: 0, defend: false, close: false });
  });

  it("uses its own fallback profile when car.ai is missing", () => {
    const { car, track } = readyCar({ ai: null });
    const cmd = aiCommand(car, track, dt, [car], "normal", 10);
    assert.ok(Number.isFinite(cmd.throttle));
    assert.ok(Number.isFinite(cmd.steer));
  });
});
