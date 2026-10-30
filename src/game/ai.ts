import { clamp, wrapAngle } from "./math";
import { projectInto, sampleAt, sampleIndexAt, type Projection, type Track } from "./track";
import { AI_CARS, type AiDifficulty, type AiProfile } from "./tuning";
import { VECTOR, vehicleById } from "./vehicle-def";
import type { CarState, InputCommand } from "./types";

const scratch: Projection = {
  sampleIndex: 0,
  x: 0,
  y: 0,
  z: 0,
  tx: 0,
  ty: 0,
  tz: 0,
  rx: 0,
  rz: 0,
  lat: 0,
  arc: 0,
  width: 16,
  curv: 0,
  jump: false,
};

const traffic = { side: 0, defend: false, close: false };

/** Decision-only. Pace never exceeds the grip target, and nothing here scales force. */
const DIFF: Record<
  AiDifficulty,
  { brake: number; pace: number; mistake: number; nitro: number; line: number; react: number; recover: number }
> = {
  easy: { brake: 14, pace: 0.93, mistake: 0.05, nitro: 0.14, line: 0.88, react: 1.25, recover: 0.94 },
  normal: { brake: 0, pace: 1, mistake: 0, nitro: 0, line: 1, react: 1, recover: 1 },
  hard: { brake: -4, pace: 1, mistake: -0.1, nitro: -0.14, line: 1.04, react: 0.7, recover: 1.04 },
};

/** Straight-line brake is ~11 m/s², but trail-braking shares the tire, so plan a longer stop. */
const BRAKE_DECEL = 17.2;

function scanTraffic(car: CarState, cars: readonly CarState[], track: Track): void {
  traffic.side = 0;
  traffic.defend = false;
  traffic.close = false;
  const n = cars.length;
  for (let i = 0; i < n; i++) {
    const other = cars[i]!;
    if (other === car) continue;
    let delta = other.arc - car.arc;
    if (delta > track.length * 0.5) delta -= track.length;
    if (delta < -track.length * 0.5) delta += track.length;
    const sideBy = Math.abs(other.latOff - car.latOff) < scratch.width * 0.6;
    if (!sideBy) continue;
    if (delta > 2.5 && delta < 18) {
      traffic.side = other.latOff >= car.latOff ? -1 : 1;
      if (delta < 8 && car.forwardSpeed > other.forwardSpeed - 2) traffic.close = true;
    } else if (delta < -2 && delta > -14) {
      traffic.defend = true;
    }
  }
}

/** Same vehicle commands as the player. Difficulty only changes decisions. */
export function aiCommand(
  car: CarState,
  track: Track,
  dt: number,
  cars: readonly CarState[],
  difficulty: AiDifficulty,
  raceTime: number,
): InputCommand {
  const ai: AiProfile = car.ai ?? AI_CARS[1]!;
  const diff = DIFF[difficulty];
  const vehicle = vehicleById(car.vehicleId);
  const cruise = track.referenceSpeed;
  const gripScale = Math.sqrt(vehicle.latGrip / VECTOR.latGrip);
  const brakeDecel = BRAKE_DECEL * (vehicle.brakeAccel / VECTOR.brakeAccel);
  projectInto(track, car.x, car.z, car.hint, scratch);
  const speed = Math.max(0, car.forwardSpeed);
  const look = 12 + Math.min(24, Math.max(8, speed) * 0.4);
  const aim = sampleAt(track, scratch.arc + look);
  const soon = sampleAt(track, scratch.arc + 22);
  const prev = sampleAt(track, scratch.arc - 18);

  const corner = Math.min(1, Math.abs(aim.curv) / 0.01);
  const entering = Math.abs(soon.curv) > Math.abs(scratch.curv) + 0.001 && Math.abs(soon.curv) > 0.005;
  const cornerId = Math.floor(scratch.arc / 160);
  const roll = Math.sin(cornerId * 12.9898 + ai.seed * 78.233) * 0.5 + 0.5;
  const mistakeChance = clamp(ai.mistake + diff.mistake, 0, 0.4);
  let lineMiss = 0;
  let brakeExtra = ai.brakeEarly + diff.brake;
  if (entering && roll < mistakeChance) {
    const late = Math.sin(cornerId * 3.1 + ai.seed) > 0;
    brakeExtra += late ? -7 : 9;
    lineMiss = (late ? 1 : -0.8) * Math.min(1.6, scratch.width * 0.08);
  }

  const lineGain = clamp(ai.lineAccuracy * diff.line, 0.55, 1.08);
  let targetLat = aim.line * ai.apex * lineGain + car.lane * (1 - corner) + lineMiss;
  scanTraffic(car, cars, track);
  if (traffic.side !== 0) targetLat += traffic.side * Math.min(2.8, scratch.width * 0.18);
  else if (traffic.defend) targetLat -= Math.sign(soon.curv || scratch.curv || 1) * 0.7;
  const limit = aim.width * 0.36;
  if (targetLat > limit) targetLat = limit;
  else if (targetLat < -limit) targetLat = -limit;

  const px = aim.x + aim.rx * targetLat;
  const pz = aim.z + aim.rz * targetLat;
  const desired = Math.atan2(-(px - car.x), -(pz - car.z));
  let steer = clamp(wrapAngle(desired - car.yaw) / 0.42, -1, 1) * ai.cornering;

  const here = sampleAt(track, scratch.arc);
  const err = scratch.lat - here.line;
  car.aiLineError = err;
  car.aiNode = sampleIndexAt(track, scratch.arc + look);
  const off = Math.abs(scratch.lat) > scratch.width * 0.4 || Math.abs(err) > scratch.width * 0.55;
  if (off) {
    steer = clamp(scratch.lat / (scratch.width * 0.32), -1, 1) * clamp(ai.recovery * diff.recover, 0.6, 1.08);
  }

  const smooth = 1 - Math.exp(-dt / Math.max(0.04, ai.reaction * diff.react));
  car.aiSteer += (clamp(steer, -1, 1) - car.aiSteer) * smooth;

  const pace = Math.min(1, ai.pace * diff.pace);
  const horizon = 36 + Math.max(8, speed) * 1.35;
  let worst = cruise;
  let worstAt = horizon;
  for (let d = 8; d <= horizon; d += 8) {
    const sample = sampleAt(track, scratch.arc + d);
    const v = Math.min(cruise * 0.98, sample.speed * pace * gripScale);
    if (v < worst) {
      worst = v;
      worstAt = d;
    }
  }
  car.aiTarget = worst;

  const gap = speed - worst;
  const stopDist = gap > 0 ? (speed * speed - worst * worst) / brakeDecel : 0;
  car.aiBrakeDist = worstAt - stopDist - brakeExtra;

  let throttle = ai.throttleCap;
  let brake = 0;
  let state = "CRUISE";
  if (off || car.stuck > 1.5) {
    brake = speed > 28 ? 0.35 : 0;
    throttle = car.stuck > 1.2 ? 0.7 : 0.4;
    state = "RECOVER";
  } else if (gap > 0.8 && stopDist + brakeExtra > worstAt) {
    const into = clamp((stopDist + brakeExtra - worstAt) / 16, 0.15, 1);
    brake = clamp(gap / 9, 0, 1) * into;
    if (gap < 2.2) brake *= gap / 2.2;
    throttle = brake > 0.4 ? 0 : ai.throttleCap * (1 - brake);
    state = "BRAKE";
  } else if (Math.abs(soon.curv) > Math.abs(scratch.curv) + 0.0015 && Math.abs(soon.curv) > 0.005) {
    state = "TURN_IN";
    if (speed > worst + 1.5) throttle = ai.throttleCap * 0.55;
  } else if (Math.abs(scratch.curv) > 0.006 && Math.abs(scratch.curv) >= Math.abs(soon.curv)) {
    state = "APEX";
    if (speed > worst + 1) {
      throttle = 0.4;
      brake = clamp((speed - worst) / 14, 0, 0.4);
    }
  } else if (Math.abs(prev.curv) > Math.abs(scratch.curv) + 0.0015 && Math.abs(prev.curv) > 0.005) {
    state = "EXIT";
    throttle = ai.throttleCap;
    if (roll < mistakeChance * 0.65) throttle *= 0.78;
    if (traffic.defend) throttle = Math.min(1, throttle + 0.05);
  } else if (speed < worst - 2) {
    state = "ACCELERATE";
  }

  if (traffic.side !== 0 && state !== "RECOVER" && state !== "BRAKE") state = "OVERTAKE";
  else if (traffic.defend && (state === "CRUISE" || state === "ACCELERATE" || state === "EXIT")) state = "DEFEND";
  if (traffic.close && (state === "OVERTAKE" || state === "CRUISE")) throttle = Math.min(throttle, 0.78);

  const straight =
    worst > 38 &&
    worstAt > 30 &&
    brake < 0.05 &&
    Math.abs(car.slipAngle) < 0.18 &&
    Math.abs(scratch.lat) < scratch.width * 0.38;
  const attack = traffic.side !== 0 && straight && ai.nitroAt < 0.5;
  const nitroNeed = clamp(ai.nitroAt + diff.nitro, 0.2, 0.92);
  let boost =
    car.boostLock <= 0 &&
    speed > 24 &&
    state !== "RECOVER" &&
    state !== "BRAKE" &&
    straight &&
    (car.boostEnergy > nitroNeed || (attack && car.boostEnergy > 0.42));
  if (raceTime < ai.launch) {
    throttle *= 0.35;
    boost = false;
    if (state !== "RECOVER") state = "CRUISE";
  }
  if (boost) state = "NITRO";
  car.aiState = state;

  return {
    throttle: clamp(throttle, 0, 1),
    brake: clamp(brake, 0, 1),
    steer: car.aiSteer,
    drift: false,
    boost,
  };
}
