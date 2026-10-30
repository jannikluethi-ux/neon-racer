import type { AiProfile } from "./tuning";

export type Phase = "menu" | "grid" | "countdown" | "racing" | "finishing" | "results";

export type CourseId = "race" | "pad";

export type InputCommand = {
  throttle: number;
  brake: number;
  /** +1 turns left on a chase camera, -1 turns right. */
  steer: number;
  drift: boolean;
  boost: boolean;
};

export const IDLE_INPUT: InputCommand = {
  throttle: 0,
  brake: 0,
  steer: 0,
  drift: false,
  boost: false,
};

export type CarState = {
  id: string;
  name: string;
  /** VehicleDefinition id. Physics reads this, never the display name. */
  vehicleId: string;
  color: number;
  isPlayer: boolean;
  ai: AiProfile | null;
  x: number;
  y: number;
  z: number;
  yaw: number;
  yawRate: number;
  vx: number;
  vz: number;
  vy: number;
  airborne: boolean;
  wasJump: boolean;
  boostEnergy: number;
  boostLock: number;
  boostTime: number;
  boostBlend: number;
  drifting: boolean;
  driftCharge: number;
  /** 0 grip, 1 limit, 2 slip, 3 drift, 4 recovery. Emergent, not a button. */
  driftState: number;
  slipAngle: number;
  frontUse: number;
  rearUse: number;
  frontLoad: number;
  rearLoad: number;
  liftBlend: number;
  gripBlend: number;
  gear: number;
  rpm: number;
  shiftLock: number;
  shifts: number;
  longAccel: number;
  latAccel: number;
  latVel: number;
  longSlip: number;
  latSlip: number;
  longUse: number;
  latUse: number;
  wheelspin: number;
  bodyPitch: number;
  bodyRoll: number;
  laps: number;
  nextGate: number;
  /** 0..1 progress from the previous checkpoint toward the next one. */
  sector: number;
  lapClock: number;
  lastLap: number;
  bestLap: number;
  arc: number;
  raceDist: number;
  arcReady: boolean;
  finished: boolean;
  finishTime: number;
  finishPlace: number;
  stuck: number;
  forwardSpeed: number;
  slip: number;
  latOff: number;
  roadHalf: number;
  crashPulse: number;
  steerVisual: number;
  throttleVisual: number;
  brakeVisual: number;
  boosting: boolean;
  aiSteer: number;
  aiState: string;
  aiTarget: number;
  aiBrakeDist: number;
  aiLineError: number;
  aiNode: number;
  lane: number;
  travel: number;
  nitroUses: number;
  hint: number;
  wheelSpin: number;
  respawnArc: number;
  prevX: number;
  prevZ: number;
  spawnX: number;
  spawnY: number;
  spawnZ: number;
  spawnYaw: number;
  spawnArc: number;
};
