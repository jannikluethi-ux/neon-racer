/** Shared presentation. Vehicle differences do not live here. */
export const PRESENT = {
  pitchGain: 0.0065,
  rollGain: 0.0075,
  camAccelPull: 0.9,
  camBoostPull: 0.65,
  camAccelFov: 4.2,
  camBoostFov: 3.2,
  camAccelShake: 0.03,
  camBoostShake: 0.045,
};

export type GearSpec = {
  /** Speed where normalized RPM is 0. */
  lo: number;
  /** Speed where normalized RPM is 1. */
  red: number;
  /** Upshift speed. */
  up: number;
  /** Downshift speed. */
  down: number;
  /** Torque multiplier. Lower gears pull harder. */
  mul: number;
};

export const RACE = {
  laps: 3,
  gridHold: 0.75,
  qaGridHold: 0.05,
  countdown: 3.55,
  qaCountdown: 0.3,
  finalBanner: 2.4,
  finishBanner: 1.6,
  /** After the player finishes, wait this long for the rest of the field. */
  finishGrace: 22,
};

export type AiDifficulty = "easy" | "normal" | "hard";

export type AiProfile = {
  name: string;
  color: number;
  /** Vehicle definition id. Pace never rewrites that car's physics. */
  vehicleId: string;
  /** Kept at 1. Difficulty never multiplies engine force or grip. */
  maxSpeedMul: number;
  accelMul: number;
  /** Fraction of the grip-limited corner speed this driver aims for. */
  pace: number;
  /** Extra meters added to the braking distance. Negative means later. */
  brakeEarly: number;
  throttleCap: number;
  /** How deep they take the apex. Above 1 is aggressive. */
  apex: number;
  /** Nitro is saved until the meter is above this. */
  nitroAt: number;
  /** How often a corner gets a small mistake. Higher is messier. */
  mistake: number;
  /** Seconds after GO before this driver is fully committed. */
  launch: number;
  seed: number;
  cornering: number;
  reaction: number;
  recovery: number;
  lineAccuracy: number;
};

export const PLAYER_COLOR = 0x2ee6ff;

export const AI_CARS: AiProfile[] = [
  {
    name: "VEX",
    color: 0xff3dce,
    vehicleId: "vector",
    maxSpeedMul: 1,
    accelMul: 1,
    pace: 1,
    brakeEarly: -2,
    throttleCap: 1,
    apex: 1.05,
    nitroAt: 0.34,
    mistake: 0.22,
    launch: 0,
    seed: 1.7,
    cornering: 1,
    reaction: 0.07,
    recovery: 1,
    lineAccuracy: 0.96,
  },
  {
    name: "ION",
    color: 0xb26bff,
    vehicleId: "vanta",
    maxSpeedMul: 1,
    accelMul: 1,
    pace: 0.94,
    brakeEarly: 10,
    throttleCap: 0.97,
    apex: 1,
    nitroAt: 0.62,
    mistake: 0.08,
    launch: 0.08,
    seed: 4.2,
    cornering: 0.98,
    reaction: 0.1,
    recovery: 1,
    lineAccuracy: 0.98,
  },
  {
    name: "NYX",
    color: 0xffb020,
    vehicleId: "surge",
    maxSpeedMul: 1,
    accelMul: 1,
    pace: 0.84,
    brakeEarly: 24,
    throttleCap: 0.9,
    apex: 0.72,
    nitroAt: 0.86,
    mistake: 0.04,
    launch: 0.18,
    seed: 8.1,
    cornering: 0.94,
    reaction: 0.14,
    recovery: 1,
    lineAccuracy: 0.99,
  },
];
