import type { Sample, Track } from "./track";
import type { CarState, InputCommand } from "./types";
import { applyLaunch, stepCar } from "./vehicle";
import { VANTA, VECTOR, type VehicleDefinition } from "./vehicle-def";

export type VehicleStats = {
  launch: number;
  topKmh: number;
  grip: number;
  brake: number;
  nitro: number;
};

const cache = new Map<string, VehicleStats>();

function straight(): Track {
  const n = 24;
  const seg = 80;
  const samples: Sample[] = [];
  for (let i = 0; i < n; i++) {
    samples.push({
      x: i * seg,
      y: 0,
      z: 0,
      tx: 1,
      ty: 0,
      tz: 0,
      rx: 0,
      rz: 1,
      dist: i * seg,
      segLen: seg,
      width: 400,
      curv: 0,
      line: 0,
      speed: 80,
      jump: false,
    });
  }
  return {
    id: "stat",
    name: "Stat",
    laps: 1,
    referenceSpeed: 80,
    grid: { holdBack: 10, rowGap: 8, lat: 0 },
    themeId: "pad",
    samples,
    gates: [],
    length: n * seg,
    minX: 0,
    maxX: n * seg,
    minZ: -10,
    maxZ: 10,
    minY: 0,
  };
}

function blank(def: VehicleDefinition): CarState {
  return {
    id: def.id,
    name: def.name,
    vehicleId: def.id,
    color: def.color,
    isPlayer: true,
    ai: null,
    x: 80,
    y: 0,
    z: 0,
    yaw: Math.atan2(-1, 0),
    yawRate: 0,
    vx: 0,
    vz: 0,
    vy: 0,
    airborne: false,
    wasJump: false,
    boostEnergy: 1,
    boostLock: 0,
    boostTime: 0,
    boostBlend: 0,
    drifting: false,
    driftCharge: 0,
    driftState: 0,
    slipAngle: 0,
    frontUse: 0,
    rearUse: 0,
    frontLoad: 0.5,
    rearLoad: 0.5,
    liftBlend: 0,
    gripBlend: 1,
    gear: 0,
    rpm: 0.2,
    shiftLock: 0,
    shifts: 0,
    longAccel: 0,
    latAccel: 0,
    latVel: 0,
    longSlip: 0,
    latSlip: 0,
    longUse: 0,
    latUse: 0,
    wheelspin: 0,
    bodyPitch: 0,
    bodyRoll: 0,
    laps: 0,
    nextGate: 0,
    sector: 0,
    sectorIndex: 0,
    sectorClock: 0,
    sectorTimes: [],
    bestSectorTimes: [],
    lapClock: 0,
    lastLap: 0,
    bestLap: 0,
    arc: 80,
    raceDist: 80,
    arcReady: true,
    finished: false,
    finishTime: 0,
    finishPlace: 0,
    stuck: 0,
    forwardSpeed: 0,
    slip: 0,
    latOff: 0,
    roadHalf: 200,
    crashPulse: 0,
    steerVisual: 0,
    throttleVisual: 0,
    brakeVisual: 0,
    boosting: false,
    aiSteer: 0,
    aiState: "",
    aiTarget: 0,
    aiBrakeDist: 0,
    aiLineError: 0,
    aiNode: 0,
    lane: 0,
    travel: 0,
    nitroUses: 0,
    hint: -1,
    wheelSpin: 0,
    respawnArc: 0,
    prevX: 80,
    prevZ: 0,
    spawnX: 80,
    spawnY: 0,
    spawnZ: 0,
    spawnYaw: 0,
    spawnArc: 80,
  };
}

const GAS: InputCommand = { throttle: 1, brake: 0, steer: 0, drift: false, boost: false };
const BRAKE: InputCommand = { throttle: 0, brake: 1, steer: 0, drift: false, boost: false };
const DT = 1 / 60;

/** Numbers come from the same step the race uses, on a straight. */
export function measureVehicle(def: VehicleDefinition): VehicleStats {
  const hit = cache.get(def.id);
  if (hit) return hit;
  const track = straight();
  const car = blank(def);
  applyLaunch(car, 0);
  let launch = 0;
  for (let i = 0; i < 12 * 60; i++) {
    stepCar(car, GAS, track, DT, 1);
    if (launch === 0 && car.forwardSpeed >= 28) launch = 28 / ((i + 1) * DT);
  }
  let top = 0;
  for (let i = 0; i < 28 * 60; i++) {
    stepCar(car, GAS, track, DT, 1);
    if (car.forwardSpeed > top) top = car.forwardSpeed;
  }
  applyLaunch(car, 40);
  let peakBrake = 0;
  for (let i = 0; i < 5 * 60; i++) {
    stepCar(car, BRAKE, track, DT, 1);
    if (-car.longAccel > peakBrake) peakBrake = -car.longAccel;
  }
  const stats: VehicleStats = {
    launch: launch || car.forwardSpeed / 12,
    topKmh: top * 3.6,
    grip: def.latGrip,
    brake: peakBrake,
    nitro: def.boostForceMul,
  };
  cache.set(def.id, stats);
  return stats;
}

export const STAT_SCALES = {
  launch: 16,
  topKmh: 220,
  grip: 20,
  brake: 16,
  nitro: 2,
};

export function previewStats(): { vector: VehicleStats; vanta: VehicleStats } {
  return { vector: measureVehicle(VECTOR), vanta: measureVehicle(VANTA) };
}
