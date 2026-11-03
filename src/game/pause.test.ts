import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSim, startCountdown, stepSim } from "./simulation.ts";
import { advanceSimulationFrame, SIMULATION_STEP } from "./simulation-frame.ts";
import { bindPauseOnHidden } from "./pause-visibility.ts";
import { useGame } from "./store.ts";
import { IDLE_INPUT } from "./types.ts";

afterEach(() => useGame.setState({ phase: "menu", paused: false }));

function untilRacing(sim: ReturnType<typeof createSim>): void {
  if (sim.phase === "menu" || sim.phase === "results") startCountdown(sim);
  for (let i = 0; i < 8 * 60 && sim.phase !== "racing"; i++) {
    stepSim(sim, SIMULATION_STEP, IDLE_INPUT, 1);
  }
}

/** Advances frames through the same fixed-step gate used by the render loop. */
function advanceFrames(sim: ReturnType<typeof createSim>, frames: number): void {
  let acc = 0;
  for (let frame = 0; frame < frames; frame++) {
    acc += SIMULATION_STEP;
    acc = advanceSimulationFrame(sim, acc, false, () => IDLE_INPUT).accumulator;
  }
}

describe("pause freezes the race", () => {
  it("does not advance race time while paused", () => {
    const sim = createSim(true);
    untilRacing(sim);
    assert.equal(sim.phase, "racing");

    // Advance a little so raceTime is non-zero.
    useGame.getState().setPaused(false);
    advanceFrames(sim, 30);
    const t0 = sim.raceTime;
    const pos0 = { x: sim.cars[0]!.x, z: sim.cars[0]!.z, speed: sim.cars[0]!.forwardSpeed };
    assert.ok(t0 > 0, "raceTime should have advanced before pausing");

    // Pause: no frames should step the sim.
    useGame.getState().setPaused(true);
    advanceFrames(sim, 60);
    assert.equal(sim.raceTime, t0, "raceTime must not advance while paused");
    assert.equal(sim.cars[0]!.x, pos0.x, "player x must not move while paused");
    assert.equal(sim.cars[0]!.z, pos0.z, "player z must not move while paused");
    assert.equal(sim.cars[0]!.forwardSpeed, pos0.speed, "player speed must be frozen while paused");

    // Resume: it should advance again.
    useGame.getState().setPaused(false);
    advanceFrames(sim, 30);
    assert.ok(sim.raceTime > t0, "raceTime should advance again after resuming");
  });

  it("pauses the real store when visibility changes to hidden during a race", () => {
    const target = new EventTarget() as EventTarget & { hidden: boolean };
    target.hidden = false;
    useGame.setState({ phase: "racing", paused: false });
    const unbind = bindPauseOnHidden(target as unknown as Document, () => {
      const phase = useGame.getState().phase;
      return phase === "grid" || phase === "countdown" || phase === "racing" || phase === "finishing";
    });

    target.hidden = true;
    target.dispatchEvent(new Event("visibilitychange"));
    assert.equal(useGame.getState().paused, true);
    unbind();
  });
});
