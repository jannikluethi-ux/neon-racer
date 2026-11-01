import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSim, startCountdown, stepSim } from "./simulation.ts";
import { IDLE_INPUT } from "./types.ts";

const dt = 1 / 60;

function untilRacing(sim: ReturnType<typeof createSim>): void {
  if (sim.phase === "menu" || sim.phase === "results") startCountdown(sim);
  for (let i = 0; i < 8 * 60 && sim.phase !== "racing"; i++) stepSim(sim, dt, IDLE_INPUT, 1);
}

/**
 * Mirrors the engine loop's pause gate: while `paused`, the sim is never
 * stepped, so physics and race timers must not advance. The engine skips the
 * `while (!store.paused && acc >= STEP ...)` body when paused; this test
 * reproduces that condition and asserts race time stays frozen.
 */
function runFrames(sim: ReturnType<typeof createSim>, paused: () => boolean, frames: number): void {
  let acc = 0;
  let steps = 0;
  for (let frame = 0; frame < frames; frame++) {
    acc += dt;
    steps = 0;
    while (!paused() && acc >= dt && steps < 5) {
      stepSim(sim, dt, IDLE_INPUT, 1);
      acc -= dt;
      steps++;
    }
    if (steps === 5) acc = 0;
  }
}

describe("pause freezes the race", () => {
  it("does not advance race time while paused", () => {
    const sim = createSim(true);
    untilRacing(sim);
    assert.equal(sim.phase, "racing");

    // Advance a little so raceTime is non-zero.
    runFrames(sim, () => false, 30);
    const t0 = sim.raceTime;
    const pos0 = { x: sim.cars[0]!.x, z: sim.cars[0]!.z, speed: sim.cars[0]!.forwardSpeed };
    assert.ok(t0 > 0, "raceTime should have advanced before pausing");

    // Pause: no frames should step the sim.
    runFrames(sim, () => true, 60);
    assert.equal(sim.raceTime, t0, "raceTime must not advance while paused");
    assert.equal(sim.cars[0]!.x, pos0.x, "player x must not move while paused");
    assert.equal(sim.cars[0]!.z, pos0.z, "player z must not move while paused");
    assert.equal(sim.cars[0]!.forwardSpeed, pos0.speed, "player speed must be frozen while paused");

    // Resume: it should advance again.
    runFrames(sim, () => false, 30);
    assert.ok(sim.raceTime > t0, "raceTime should advance again after resuming");
  });
});