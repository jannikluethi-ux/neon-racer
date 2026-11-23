import { sampleAt, type Sample, type Track } from "./track.ts";
import type { CarState } from "./types.ts";
import { PLAYER_COLOR } from "./tuning.ts";

export function straightTrack(): Track {
  const n = 40;
  const seg = 60;
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
      width: 800,
      curv: 0,
      line: 0,
      speed: 80,
      jump: false,
    });
  }
  return {
    samples,
    gates: [],
    length: n * seg,
    minX: 0,
    maxX: n * seg,
    minZ: -30,
    maxZ: 30,
    minY: 0,
    id: "straight",
    name: "Straight",
    laps: 1,
    referenceSpeed: 80,
    grid: { holdBack: 40, rowGap: 8, lat: 0 },
    themeId: "pad",
  };
}

export function carFixture(partial: Partial<CarState> = {}): CarState {
  const id = partial.id ?? "you";
  return {
    id,
    name: partial.name ?? "VECTOR",
    vehicleId: partial.vehicleId ?? "vector",
    color: partial.color ?? PLAYER_COLOR,
    isPlayer: partial.isPlayer ?? true,
    ai: partial.ai ?? null,
    x: partial.x ?? 0,
    y: partial.y ?? 0,
    z: partial.z ?? 0,
    yaw: partial.yaw ?? 0,
    yawRate: partial.yawRate ?? 0,
    vx: partial.vx ?? 0,
    vz: partial.vz ?? 0,
    vy: partial.vy ?? 0,
    airborne: partial.airborne ?? false,
    wasJump: partial.wasJump ?? false,
    boostEnergy: partial.boostEnergy ?? 1,
    boostLock: partial.boostLock ?? 0,
    boostTime: partial.boostTime ?? 0,
    boostBlend: partial.boostBlend ?? 0,
    drifting: partial.drifting ?? false,
    driftCharge: partial.driftCharge ?? 0,
    driftState: partial.driftState ?? 0,
    slipAngle: partial.slipAngle ?? 0,
    frontUse: partial.frontUse ?? 0,
    rearUse: partial.rearUse ?? 0,
    frontLoad: partial.frontLoad ?? 0.5,
    rearLoad: partial.rearLoad ?? 0.5,
    liftBlend: partial.liftBlend ?? 0,
    gripBlend: partial.gripBlend ?? 1,
    gear: partial.gear ?? 0,
    rpm: partial.rpm ?? 0.2,
    shiftLock: partial.shiftLock ?? 0,
    shifts: partial.shifts ?? 0,
    longAccel: partial.longAccel ?? 0,
    latAccel: partial.latAccel ?? 0,
    latVel: partial.latVel ?? 0,
    longSlip: partial.longSlip ?? 0,
    latSlip: partial.latSlip ?? 0,
    longUse: partial.longUse ?? 0,
    latUse: partial.latUse ?? 0,
    wheelspin: partial.wheelspin ?? 0,
    bodyPitch: partial.bodyPitch ?? 0,
    bodyRoll: partial.bodyRoll ?? 0,
    laps: partial.laps ?? 0,
    nextGate: partial.nextGate ?? 0,
    sector: partial.sector ?? 0,
    sectorIndex: partial.sectorIndex ?? 0,
    sectorClock: partial.sectorClock ?? 0,
    sectorTimes: partial.sectorTimes ?? [],
    bestSectorTimes: partial.bestSectorTimes ?? [],
    lapClock: partial.lapClock ?? 0,
    lastLap: partial.lastLap ?? 0,
    bestLap: partial.bestLap ?? 0,
    arc: partial.arc ?? 0,
    raceDist: partial.raceDist ?? 0,
    arcReady: partial.arcReady ?? true,
    finished: partial.finished ?? false,
    finishTime: partial.finishTime ?? 0,
    finishPlace: partial.finishPlace ?? 0,
    stuck: partial.stuck ?? 0,
    forwardSpeed: partial.forwardSpeed ?? 0,
    slip: partial.slip ?? 0,
    latOff: partial.latOff ?? 0,
    roadHalf: partial.roadHalf ?? 12,
    crashPulse: partial.crashPulse ?? 0,
    steerVisual: partial.steerVisual ?? 0,
    throttleVisual: partial.throttleVisual ?? 0,
    brakeVisual: partial.brakeVisual ?? 0,
    boosting: partial.boosting ?? false,
    aiSteer: partial.aiSteer ?? 0,
    aiState: partial.aiState ?? "line",
    aiTarget: partial.aiTarget ?? 0,
    aiBrakeDist: partial.aiBrakeDist ?? 0,
    aiLineError: partial.aiLineError ?? 0,
    aiNode: partial.aiNode ?? 0,
    lane: partial.lane ?? 0,
    travel: partial.travel ?? 0,
    nitroUses: partial.nitroUses ?? 0,
    hint: partial.hint ?? -1,
    wheelSpin: partial.wheelSpin ?? 0,
    kerbL: partial.kerbL ?? 0,
    kerbR: partial.kerbR ?? 0,
    gradePitch: partial.gradePitch ?? 0,
    gradeRoll: partial.gradeRoll ?? 0,
    wheelKerb: partial.wheelKerb ?? [0, 0, 0, 0],
    wheelNormals: partial.wheelNormals ?? [
      [0, 1, 0],
      [0, 1, 0],
      [0, 1, 0],
      [0, 1, 0],
    ],
    respawnArc: partial.respawnArc ?? 0,
    prevX: partial.prevX ?? 0,
    prevZ: partial.prevZ ?? 0,
    spawnX: partial.spawnX ?? 0,
    spawnY: partial.spawnY ?? 0,
    spawnZ: partial.spawnZ ?? 0,
    spawnYaw: partial.spawnYaw ?? 0,
    spawnArc: partial.spawnArc ?? 0,
  };
}

export function placeOnTrack(car: CarState, track: Track, arc: number): void {
  const s = sampleAt(track, arc);
  car.x = s.x + s.rx * (car.latOff ?? 0);
  car.z = s.z + s.rz * (car.latOff ?? 0);
  car.y = s.y;
  car.yaw = Math.atan2(-s.tx, -s.tz);
  car.hint = -1;
  car.arc = s.dist;
  car.arcReady = true;
}
