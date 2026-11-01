import type { GearSpec } from "./tuning";

/**
 * One physics model, many cars. Every field is read by the shared controller.
 * Do not add a vehicle-name branch to the simulator — add a definition.
 * peakForce is specific (m/s²) at the reference mass. Mass scales it.
 */
export const REFERENCE_MASS = 1180;

export type BodyStyle = {
  paint: number;
  accent: number;
  glass: number;
  body: readonly [number, number, number];
  cabin: readonly [number, number, number];
  nose: readonly [number, number, number];
  wing: readonly [number, number, number];
  wingZ: number;
};

export type VoiceSpec = {
  /** Multiplier on the shared engine note. */
  pitch: number;
  detune: number;
  /** Second oscillator level. Higher is rougher. */
  grit: number;
  harm: number;
  /** Extra nitro bark. */
  bark: number;
  exhaust: number;
};

export type VehicleDefinition = {
  id: string;
  name: string;
  description: string;
  startsUnlocked: boolean;
  color: number;
  body: BodyStyle;
  voice: VoiceSpec;
  mass: number;
  peakForce: number;
  rolling: number;
  dragK: number;
  engineBrake: number;
  safetySpeed: number;
  reverseSpeed: number;
  reverseForce: number;
  airControl: number;
  boostForceMul: number;
  boostPowerFloor: number;
  boostDuration: number;
  boostCooldown: number;
  boostRecharge: number;
  boostRamp: number;
  shiftTime: number;
  shiftCut: number;
  steeringSensitivity: number;
  maxSteer: number;
  steerFloor: number;
  steerFalloff: number;
  steerCurve: number;
  slipPeak: number;
  slipWiden: number;
  slipWidenSpeed: number;
  frontPeakMul: number;
  rearPeakMul: number;
  axleFront: number;
  axleRear: number;
  yawInertia: number;
  yawDamp: number;
  yawDampSpeed: number;
  yawAssist: number;
  yawAssistEnd: number;
  longGrip: number;
  latGrip: number;
  latDownforce: number;
  frontShare: number;
  rearShare: number;
  loadTransfer: number;
  loadClamp: number;
  liftFront: number;
  latUnload: number;
  longCombineDriveFront: number;
  longCombineDriveRear: number;
  longCombineBrakeFront: number;
  longCombineBrakeRear: number;
  latCombine: number;
  spinRate: number;
  lowSpin: number;
  lowSpinSpeed: number;
  boostSpin: number;
  slipRelax: number;
  brakeAccel: number;
  airGrip: number;
  downforce: number;
  gears: readonly GearSpec[];
  power: readonly (readonly [number, number])[];
};

const VECTOR_BODY: BodyStyle = {
  paint: 0x123844,
  accent: 0x2ee6ff,
  glass: 0xb7e9ff,
  body: [1, 1, 1],
  cabin: [1, 1, 1],
  nose: [1, 1, 1],
  wing: [1, 1, 1],
  wingZ: 1.72,
};

/** Baseline car. Numbers are the original Apex tune — do not drift them. */
export const VECTOR: VehicleDefinition = {
  id: "vector",
  name: "VECTOR GT3",
  description: "Balanced GT3 coupe. Predictable, stable, and happy to flow.",
  startsUnlocked: true,
  color: 0x2ee6ff,
  body: VECTOR_BODY,
  voice: { pitch: 1, detune: 1.006, grit: 0.75, harm: 0.7, bark: 0, exhaust: 1 },
  mass: REFERENCE_MASS,
  peakForce: 14.4,
  rolling: 0.48,
  dragK: 0.00255,
  engineBrake: 0.55,
  safetySpeed: 70,
  reverseSpeed: 16,
  reverseForce: 5.1,
  airControl: 0.42,
  boostForceMul: 1.52,
  boostPowerFloor: 0.78,
  boostDuration: 2.25,
  boostCooldown: 1.1,
  boostRecharge: 3.8,
  boostRamp: 0.2,
  shiftTime: 0.16,
  shiftCut: 0.62,
  steeringSensitivity: 1,
  maxSteer: 0.36,
  steerFloor: 0.48,
  steerFalloff: 24,
  steerCurve: 1.25,
  slipPeak: 0.11,
  slipWiden: 0.62,
  slipWidenSpeed: 8,
  frontPeakMul: 0.9,
  rearPeakMul: 1.08,
  axleFront: 1.12,
  axleRear: 1.55,
  yawInertia: 2.05,
  yawDamp: 0.95,
  yawDampSpeed: 0.03,
  yawAssist: 4.6,
  yawAssistEnd: 11,
  longGrip: 12.6,
  latGrip: 14.6,
  latDownforce: 0.16,
  frontShare: 0.47,
  rearShare: 0.53,
  loadTransfer: 0.02,
  loadClamp: 0.18,
  liftFront: 0.1,
  latUnload: 0.004,
  longCombineDriveFront: 0.18,
  longCombineDriveRear: 0.92,
  longCombineBrakeFront: 0.35,
  longCombineBrakeRear: 0.58,
  latCombine: 0.7,
  spinRate: 0.5,
  lowSpin: 1.07,
  lowSpinSpeed: 11,
  boostSpin: 0.55,
  slipRelax: 0.1,
  brakeAccel: 11.05,
  airGrip: 0.14,
  downforce: 0.35,
  gears: [
    { lo: 0, red: 11.2, up: 8.8, down: 0, mul: 1.5 },
    { lo: 5.2, red: 18.4, up: 15.8, down: 7.1, mul: 1.14 },
    { lo: 11.2, red: 27.2, up: 23.8, down: 13.2, mul: 0.9 },
    { lo: 18.4, red: 37.2, up: 33.2, down: 20.4, mul: 0.72 },
    { lo: 26.4, red: 46.5, up: 40.6, down: 28.8, mul: 0.58 },
    { lo: 33.2, red: 55.5, up: 90, down: 36.8, mul: 0.6 },
  ],
  power: [
    [0, 0.36],
    [0.2, 0.55],
    [0.42, 0.86],
    [0.66, 1],
    [0.82, 0.9],
    [0.93, 0.66],
    [1, 0.42],
  ],
};

/** Short-geared, light, rear-happy. Same tire model as Vector. */
export const VANTA: VehicleDefinition = {
  id: "vanta",
  name: "VANTA GT4",
  description: "Short-wheelbase GT4 coupe. Explosive launch with a lively rear.",
  startsUnlocked: true,
  color: 0xff4d24,
  body: {
    paint: 0x2a100c,
    accent: 0xff4d24,
    glass: 0xffd2bc,
    body: [1.14, 0.82, 0.9],
    cabin: [1.05, 0.78, 0.82],
    nose: [0.9, 0.9, 0.7],
    wing: [1.28, 1.2, 1.45],
    wingZ: 1.62,
  },
  voice: { pitch: 1.05, detune: 1.012, grit: 1.3, harm: 1.15, bark: 0.01, exhaust: 1 },
  mass: 1020,
  peakForce: 15.8,
  rolling: 0.5,
  dragK: 0.00268,
  engineBrake: 0.62,
  safetySpeed: 70,
  reverseSpeed: 16,
  reverseForce: 5.1,
  airControl: 0.42,
  boostForceMul: 1.46,
  boostPowerFloor: 0.78,
  boostDuration: 2.05,
  boostCooldown: 1.15,
  boostRecharge: 4.15,
  boostRamp: 0.16,
  shiftTime: 0.14,
  shiftCut: 0.58,
  steeringSensitivity: 1.03,
  maxSteer: 0.38,
  steerFloor: 0.5,
  steerFalloff: 22,
  steerCurve: 1.2,
  slipPeak: 0.11,
  slipWiden: 0.62,
  slipWidenSpeed: 8,
  frontPeakMul: 0.98,
  rearPeakMul: 0.98,
  axleFront: 1.1,
  axleRear: 1.6,
  yawInertia: 1.92,
  yawDamp: 0.88,
  yawDampSpeed: 0.028,
  yawAssist: 4.8,
  yawAssistEnd: 12,
  longGrip: 14.8,
  latGrip: 14.4,
  latDownforce: 0.12,
  frontShare: 0.52,
  rearShare: 0.48,
  loadTransfer: 0.022,
  loadClamp: 0.18,
  liftFront: 0.08,
  latUnload: 0.004,
  longCombineDriveFront: 0.14,
  longCombineDriveRear: 1.05,
  longCombineBrakeFront: 0.38,
  longCombineBrakeRear: 0.54,
  latCombine: 0.7,
  spinRate: 0.54,
  lowSpin: 1.08,
  lowSpinSpeed: 12,
  boostSpin: 0.58,
  slipRelax: 0.12,
  brakeAccel: 11.2,
  airGrip: 0.14,
  downforce: 0.22,
  gears: [
    { lo: 0, red: 10.2, up: 8.2, down: 0, mul: 1.42 },
    { lo: 4.8, red: 16.8, up: 14.4, down: 6.4, mul: 1.16 },
    { lo: 10.2, red: 24.2, up: 21.2, down: 12.2, mul: 0.9 },
    { lo: 16.4, red: 32.4, up: 28.8, down: 18.4, mul: 0.68 },
    { lo: 23.2, red: 40.5, up: 36.4, down: 25.6, mul: 0.5 },
    { lo: 30, red: 54, up: 90, down: 33.2, mul: 0.5 },
  ],
  power: [
    [0, 0.48],
    [0.18, 0.74],
    [0.36, 1],
    [0.55, 0.94],
    [0.72, 0.72],
    [0.86, 0.5],
    [1, 0.34],
  ],
};

/** Long gearing, low drag, calm rear. Slow until the straight opens up. */
export const SURGE: VehicleDefinition = {
  id: "surge",
  name: "SURGE LMP",
  description: "Long-tail prototype. Top speed and high-speed stability.",
  startsUnlocked: false,
  color: 0xffe14a,
  body: {
    paint: 0x2c2610,
    accent: 0xffe14a,
    glass: 0xfff6d2,
    body: [0.9, 0.74, 1.32],
    cabin: [0.82, 0.7, 1.2],
    nose: [0.72, 0.7, 1.35],
    wing: [1.05, 0.7, 1.1],
    wingZ: 1.95,
  },
  voice: { pitch: 0.9, detune: 1.004, grit: 0.5, harm: 0.42, bark: 0, exhaust: 1.35 },
  mass: 1240,
  peakForce: 14,
  rolling: 0.42,
  dragK: 0.00228,
  engineBrake: 0.42,
  safetySpeed: 78,
  reverseSpeed: 16,
  reverseForce: 4.6,
  airControl: 0.4,
  boostForceMul: 1.38,
  boostPowerFloor: 0.84,
  boostDuration: 2.4,
  boostCooldown: 1.2,
  boostRecharge: 4.4,
  boostRamp: 0.24,
  shiftTime: 0.18,
  shiftCut: 0.7,
  steeringSensitivity: 0.94,
  maxSteer: 0.32,
  steerFloor: 0.55,
  steerFalloff: 30,
  steerCurve: 1.35,
  slipPeak: 0.1,
  slipWiden: 0.55,
  slipWidenSpeed: 10,
  frontPeakMul: 0.96,
  rearPeakMul: 1.14,
  axleFront: 1.2,
  axleRear: 1.48,
  yawInertia: 2.35,
  yawDamp: 1.08,
  yawDampSpeed: 0.02,
  yawAssist: 3.6,
  yawAssistEnd: 14,
  longGrip: 12.2,
  latGrip: 15.2,
  latDownforce: 0.28,
  frontShare: 0.46,
  rearShare: 0.58,
  loadTransfer: 0.016,
  loadClamp: 0.16,
  liftFront: 0.06,
  latUnload: 0.003,
  longCombineDriveFront: 0.2,
  longCombineDriveRear: 0.72,
  longCombineBrakeFront: 0.4,
  longCombineBrakeRear: 0.62,
  latCombine: 0.66,
  spinRate: 0.42,
  lowSpin: 1.02,
  lowSpinSpeed: 14,
  boostSpin: 0.4,
  slipRelax: 0.08,
  brakeAccel: 10.4,
  airGrip: 0.16,
  downforce: 0.55,
  gears: [
    { lo: 0, red: 14.5, up: 11.4, down: 0, mul: 1.14 },
    { lo: 7.2, red: 24, up: 20, down: 8.4, mul: 1.08 },
    { lo: 14.5, red: 34, up: 29, down: 16.2, mul: 0.96 },
    { lo: 22, red: 44, up: 38.5, down: 24.5, mul: 0.82 },
    { lo: 31, red: 54, up: 47.5, down: 34, mul: 0.72 },
    { lo: 28, red: 64, up: 90, down: 44, mul: 0.6 },
  ],
  power: [
    [0, 0.22],
    [0.25, 0.42],
    [0.45, 0.72],
    [0.62, 0.95],
    [0.78, 1],
    [0.9, 0.92],
    [1, 0.78],
  ],
};

/** High grip and brakes. Runs out of breath on a long straight. */
export const AEGIS: VehicleDefinition = {
  id: "aegis",
  name: "AEGIS TCR",
  description: "Wide touring car. Big brakes and grip for technical circuits.",
  startsUnlocked: false,
  color: 0x9fd4ff,
  body: {
    paint: 0x1c2836,
    accent: 0x9fd4ff,
    glass: 0xe7f3ff,
    body: [1.26, 0.96, 0.94],
    cabin: [1.12, 0.9, 0.88],
    nose: [1.15, 0.9, 0.82],
    wing: [1.4, 0.85, 1.05],
    wingZ: 1.58,
  },
  voice: { pitch: 1.1, detune: 1.008, grit: 0.42, harm: 0.85, bark: 0, exhaust: 0.7 },
  mass: 1200,
  peakForce: 13.6,
  rolling: 0.5,
  dragK: 0.00153,
  engineBrake: 0.7,
  safetySpeed: 64,
  reverseSpeed: 16,
  reverseForce: 5.4,
  airControl: 0.48,
  boostForceMul: 1.34,
  boostPowerFloor: 0.8,
  boostDuration: 1.9,
  boostCooldown: 1.05,
  boostRecharge: 3.6,
  boostRamp: 0.18,
  shiftTime: 0.15,
  shiftCut: 0.66,
  steeringSensitivity: 1.02,
  maxSteer: 0.34,
  steerFloor: 0.52,
  steerFalloff: 26,
  steerCurve: 1.15,
  slipPeak: 0.1,
  slipWiden: 0.5,
  slipWidenSpeed: 9,
  frontPeakMul: 1.08,
  rearPeakMul: 1.12,
  axleFront: 1.18,
  axleRear: 1.42,
  yawInertia: 2.28,
  yawDamp: 1.14,
  yawDampSpeed: 0.034,
  yawAssist: 3.4,
  yawAssistEnd: 10,
  longGrip: 16.4,
  latGrip: 17.6,
  latDownforce: 0.22,
  frontShare: 0.5,
  rearShare: 0.56,
  loadTransfer: 0.014,
  loadClamp: 0.14,
  liftFront: 0.04,
  latUnload: 0.002,
  longCombineDriveFront: 0.22,
  longCombineDriveRear: 0.68,
  longCombineBrakeFront: 0.48,
  longCombineBrakeRear: 0.7,
  latCombine: 0.62,
  spinRate: 0.36,
  lowSpin: 1.01,
  lowSpinSpeed: 10,
  boostSpin: 0.32,
  slipRelax: 0.07,
  brakeAccel: 13.5,
  airGrip: 0.18,
  downforce: 0.62,
  gears: [
    { lo: 0, red: 11, up: 8.6, down: 0, mul: 1.02 },
    { lo: 5.2, red: 18, up: 15.2, down: 6.6, mul: 0.9 },
    { lo: 11, red: 26, up: 22.4, down: 13, mul: 0.78 },
    { lo: 17, red: 34, up: 30, down: 19.5, mul: 0.66 },
    { lo: 24, red: 42, up: 37.5, down: 26.5, mul: 0.6 },
    { lo: 32, red: 50, up: 90, down: 34.5, mul: 0.5 },
  ],
  power: [
    [0, 0.42],
    [0.2, 0.7],
    [0.4, 0.95],
    [0.55, 1],
    [0.7, 0.72],
    [0.85, 0.42],
    [1, 0.24],
  ],
};

export const VEHICLES: readonly VehicleDefinition[] = [VECTOR, VANTA, SURGE, AEGIS];

const BY_ID = new Map(VEHICLES.map((car) => [car.id, car]));

export function vehicleById(id: string | undefined): VehicleDefinition {
  return (id && BY_ID.get(id)) || VECTOR;
}

export function specificForce(def: VehicleDefinition): number {
  return def.peakForce * (REFERENCE_MASS / def.mass);
}

export function samplePower(rpm: number, curve: VehicleDefinition["power"] = VECTOR.power): number {
  const r = rpm < 0 ? 0 : rpm > 1 ? 1 : rpm;
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1]!;
    const b = curve[i]!;
    if (r <= b[0]) {
      const t = (r - a[0]) / (b[0] - a[0] || 1);
      return a[1] + (b[1] - a[1]) * t;
    }
  }
  return curve[curve.length - 1]![1];
}

export function gearForSpeed(speed: number, gears: readonly GearSpec[] = VECTOR.gears): number {
  const v = Math.abs(speed);
  let gear = 0;
  for (let i = 0; i < gears.length - 1; i++) {
    if (v >= gears[i]!.up) gear = i + 1;
    else break;
  }
  return gear;
}
