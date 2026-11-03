import { useGame } from "./store";
import { stepSim, type Sim } from "./simulation";
import type { InputCommand } from "./types";

export const SIMULATION_STEP = 1 / 60;

export type SimulationFrameResult = {
  accumulator: number;
  steps: number;
  hitPeak: number;
};

/** Runs the fixed-step simulation gate shared by the render loop and tests. */
export function advanceSimulationFrame(
  sim: Sim,
  accumulator: number,
  frozen: boolean,
  readInput: () => InputCommand,
  beforeStep?: () => void,
): SimulationFrameResult {
  let steps = 0;
  let hitPeak = 0;
  while (
    !useGame.getState().paused &&
    !frozen &&
    accumulator >= SIMULATION_STEP &&
    steps < 5
  ) {
    beforeStep?.();
    const racingInput = readInput();
    const active =
      sim.phase === "racing" || sim.phase === "countdown"
        ? racingInput
        : { ...racingInput, throttle: 0, brake: 0, steer: 0, boost: false, drift: false };
    stepSim(sim, SIMULATION_STEP, active, useGame.getState().steerSens);
    const pulseNow = sim.cars[0]?.crashPulse ?? 0;
    if (pulseNow > hitPeak) hitPeak = pulseNow;
    accumulator -= SIMULATION_STEP;
    steps++;
  }
  if (steps === 5) accumulator = 0;
  return { accumulator, steps, hitPeak };
}
