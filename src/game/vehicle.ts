import { clamp } from "./math";
import { evalTires } from "./tires";
import { projectInto, type Projection, type Track } from "./track";
import { PRESENT } from "./tuning";
import { gearForSpeed, samplePower, specificForce, vehicleById } from "./vehicle-def";
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

const DRIFT_GRIP = 0;
const DRIFT_LIMIT = 1;
const DRIFT_SLIP = 2;
const DRIFT_HOLD = 3;
const DRIFT_RECOVER = 4;

export function driftStateLabel(state: number): string {
  if (state === DRIFT_LIMIT) return "LIMIT";
  if (state === DRIFT_SLIP) return "SLIP";
  if (state === DRIFT_HOLD) return "DRIFT";
  if (state === DRIFT_RECOVER) return "RECOVER";
  return "GRIP";
}

function stepDriftState(car: CarState, forward: number, frontSlip: number, rearSlip: number, dt: number): void {
  const absA = Math.abs(car.slipAngle);
  const front = Math.abs(frontSlip);
  const rear = Math.abs(rearSlip);
  const fast = forward > 14;
  let state = car.driftState;
  if (state === DRIFT_HOLD) {
    if (!fast || absA < 0.11) state = DRIFT_RECOVER;
  } else if (state === DRIFT_RECOVER) {
    if (fast && absA > 0.2 && (rear > 1.05 || front > 1.15)) state = DRIFT_HOLD;
    else if (absA < 0.05 && front < 0.8 && rear < 0.8) state = DRIFT_GRIP;
    else state = front > 1 || rear > 1 || absA > 0.08 ? DRIFT_SLIP : DRIFT_LIMIT;
  } else if (fast && absA > 0.18 && (rear > 1.05 || front > 1.2)) {
    car.driftCharge += dt;
    state = car.driftCharge > 0.18 ? DRIFT_HOLD : DRIFT_SLIP;
  } else {
    car.driftCharge = Math.max(0, car.driftCharge - dt * 2);
    if (front > 1.05 || rear > 1.05 || absA > 0.1) state = DRIFT_SLIP;
    else if (front > 0.75 || rear > 0.75 || absA > 0.05) state = DRIFT_LIMIT;
    else state = DRIFT_GRIP;
  }
  car.driftState = state;
  car.drifting = state === DRIFT_HOLD;
}

/** Match gear, RPM and body velocity to a launched speed. No instantaneous snap later. */
export function applyLaunch(car: CarState, speed: number): void {
  const def = vehicleById(car.vehicleId);
  car.forwardSpeed = speed;
  car.latVel = 0;
  car.yawRate = 0;
  car.longAccel = 0;
  car.latAccel = 0;
  car.longSlip = 0;
  car.latSlip = 0;
  car.longUse = 0;
  car.latUse = 0;
  car.gear = gearForSpeed(speed, def.gears);
  car.rpm = speed > 2 ? 0.45 : 0.18;
  car.shiftLock = 0;
  car.gripBlend = 1;
  car.boostBlend = 0;
  car.wheelspin = 0;
  car.driftState = 0;
  car.slipAngle = 0;
  car.frontUse = 0;
  car.rearUse = 0;
  car.frontLoad = 0.5;
  car.rearLoad = 0.5;
  car.liftBlend = 0;
  car.bodyPitch = 0;
  car.bodyRoll = 0;
  car.slip = 0;
  car.drifting = false;
  const fx = -Math.sin(car.yaw);
  const fz = -Math.cos(car.yaw);
  car.vx = fx * speed;
  car.vz = fz * speed;
}

export function stepCar(car: CarState, input: InputCommand, track: Track, dt: number, steerSens: number): void {
  const def = vehicleById(car.vehicleId);
  const fx0 = -Math.sin(car.yaw);
  const fz0 = -Math.cos(car.yaw);
  const rx0 = Math.cos(car.yaw);
  const rz0 = -Math.sin(car.yaw);

  let forwardSpeed = car.vx * fx0 + car.vz * fz0;
  let lateralSpeed = car.vx * rx0 + car.vz * rz0;

  const manualBoost = input.boost && car.boostEnergy > 0.02 && car.boostLock <= 0 && !car.airborne;
  if (manualBoost) {
    car.boostEnergy = Math.max(0, car.boostEnergy - dt / def.boostDuration);
    if (car.boostEnergy <= 0) car.boostLock = def.boostCooldown;
  } else if (car.boostLock > 0) {
    car.boostLock = Math.max(0, car.boostLock - dt);
  } else if (!input.boost) {
    car.boostEnergy = Math.min(1, car.boostEnergy + dt / def.boostRecharge);
  }
  if (car.boostTime > 0) car.boostTime = Math.max(0, car.boostTime - dt);

  const wantBoost = manualBoost ? 1 : 0;
  car.boostBlend += (wantBoost - car.boostBlend) * (1 - Math.exp(-dt / def.boostRamp));
  const boosting = car.boostBlend > 0.08;

  const cornering = Math.abs(car.latSlip) > 0.55 || Math.abs(car.slipAngle) > 0.08;
  const liftTarget = input.throttle < 0.1 && car.throttleVisual > 0.4 && cornering && forwardSpeed > 10 ? 1 : 0;
  const liftK = 1 - Math.exp(-dt / (liftTarget > 0 ? 0.1 : 0.28));
  car.liftBlend += (liftTarget - car.liftBlend) * liftK;

  if (car.shiftLock > 0) car.shiftLock = Math.max(0, car.shiftLock - dt);
  else if (forwardSpeed > 1.8) {
    const gear = car.gear;
    if (gear < def.gears.length - 1 && forwardSpeed >= def.gears[gear]!.up) {
      car.gear = gear + 1;
      car.shiftLock = def.shiftTime;
      car.shifts += 1;
    } else if (gear > 0 && forwardSpeed <= def.gears[gear]!.down) {
      car.gear = gear - 1;
      car.shiftLock = def.shiftTime;
      car.shifts += 1;
    }
  } else if (forwardSpeed < 1 && car.gear !== 0 && input.throttle < 0.2) {
    car.gear = 0;
  }

  const spec = def.gears[car.gear] ?? def.gears[0]!;
  let rpmTarget = clamp((Math.abs(forwardSpeed) - spec.lo) / (spec.red - spec.lo || 1), 0.14, 1);
  if (input.throttle > 0.2 && Math.abs(forwardSpeed) < 3.5) {
    rpmTarget = Math.max(rpmTarget, 0.38 + input.throttle * 0.22);
  }
  const shifting = car.shiftLock > def.shiftTime * 0.42;
  const rpmK = 1 - Math.exp(-dt * (shifting ? 18 : 8));
  car.rpm += (rpmTarget - car.rpm) * rpmK;

  let power = samplePower(car.rpm, def.power);
  if (car.boostBlend > 0) power = Math.max(power, def.boostPowerFloor);
  const boostMul = 1 + (def.boostForceMul - 1) * car.boostBlend;
  const aiMul = car.ai?.accelMul ?? 1;
  let engine = input.throttle * specificForce(def) * power * spec.mul * boostMul * aiMul;
  if (shifting) engine *= def.shiftCut;
  if (car.airborne) engine *= def.airControl;
  if (input.brake > 0.2 && forwardSpeed > 1) engine *= 1 - input.brake * 0.85;

  let brakeDemand = 0;
  let reverse = 0;
  if (input.brake > 0 && forwardSpeed > 0.45) {
    brakeDemand = def.brakeAccel * input.brake * (car.airborne ? 0.25 : 1);
  } else if (!car.ai && input.brake > 0 && input.throttle < 0.12 && forwardSpeed < 1.4) {
    reverse = def.reverseForce * input.brake;
  }

  const tire = evalTires({
    forward: forwardSpeed,
    lateral: lateralSpeed,
    yawRate: car.yawRate,
    steer: input.steer,
    steerSens: (car.isPlayer ? steerSens : 1) * def.steeringSensitivity,
    driveDemand: engine,
    brakeDemand,
    boostBlend: car.boostBlend,
    airborne: car.airborne,
    longSlip: car.longSlip,
    longAccel: car.longAccel,
    latAccel: car.latAccel,
    lift: car.liftBlend,
    dt,
  }, def);

  let resist = 0;
  if (Math.abs(forwardSpeed) > 0.05) {
    resist = Math.sign(forwardSpeed) * def.rolling + def.dragK * forwardSpeed * Math.abs(forwardSpeed);
    if (input.throttle < 0.08 && input.brake === 0 && Math.abs(forwardSpeed) > 1.5) {
      resist += Math.sign(forwardSpeed) * def.engineBrake * car.rpm;
    }
  }

  const longAccel = tire.drive - resist - reverse;
  const latAccel = tire.lat;
  forwardSpeed += longAccel * dt;
  if (forwardSpeed > def.safetySpeed) forwardSpeed = def.safetySpeed;
  if (forwardSpeed < -def.reverseSpeed) forwardSpeed = -def.reverseSpeed;

  lateralSpeed += latAccel * dt;
  car.yawRate += tire.yawAccel * dt;
  if (car.airborne) car.yawRate *= Math.exp(-dt * 1.2);
  if (car.yawRate > 3.4) car.yawRate = 3.4;
  else if (car.yawRate < -3.4) car.yawRate = -3.4;

  const coupledU = forwardSpeed;
  const coupledV = lateralSpeed;
  forwardSpeed = coupledU - coupledV * car.yawRate * dt;
  lateralSpeed = coupledV + coupledU * car.yawRate * dt;
  if (lateralSpeed > 18) lateralSpeed = 18;
  else if (lateralSpeed < -18) lateralSpeed = -18;

  car.yaw += car.yawRate * dt;
  car.longSlip = tire.longSlip;
  car.latSlip = tire.latSlip;
  car.longUse = tire.longUse;
  car.latUse = tire.latUse;
  car.frontUse = tire.frontUse;
  car.rearUse = tire.rearUse;
  car.frontLoad = tire.frontLoad;
  car.rearLoad = tire.rearLoad;
  const slipRef = Math.abs(forwardSpeed) > 8 ? Math.abs(forwardSpeed) : 8;
  car.slipAngle = Math.atan2(lateralSpeed, slipRef);
  stepDriftState(car, forwardSpeed, tire.latSlip, tire.rearSlip, dt);
  const spinK = 1 - Math.exp(-dt * 10);
  car.wheelspin += (tire.wheelspin - car.wheelspin) * spinK;

  const fx = -Math.sin(car.yaw);
  const fz = -Math.cos(car.yaw);
  const rx = Math.cos(car.yaw);
  const rz = -Math.sin(car.yaw);
  car.vx = fx * forwardSpeed + rx * lateralSpeed;
  car.vz = fz * forwardSpeed + rz * lateralSpeed;
  car.x += car.vx * dt;
  car.z += car.vz * dt;

  projectInto(track, car.x, car.z, car.hint, scratch);
  car.hint = scratch.sampleIndex;

  const half = scratch.width * 0.5 - 1.15;
  if (scratch.lat > half || scratch.lat < -half) {
    const clamped = clamp(scratch.lat, -half, half);
    const push = scratch.lat - clamped;
    const sign = Math.sign(scratch.lat) || 1;
    const ox = scratch.rx * sign;
    const oz = scratch.rz * sign;
    const outward = car.vx * ox + car.vz * oz;
    if (outward > 0) {
      car.vx -= ox * outward * 1.35;
      car.vz -= oz * outward * 1.35;
      car.crashPulse = Math.max(car.crashPulse, Math.min(1, outward / 12));
    }
    const along = car.vx * scratch.tx + car.vz * scratch.tz;
    const scrape = Math.min(Math.abs(along), (8 + Math.abs(push) * 46 + Math.max(0, outward) * 1.4) * dt);
    if (scrape > 0) {
      const dir = Math.sign(along) || 1;
      car.vx -= scratch.tx * dir * scrape;
      car.vz -= scratch.tz * dir * scrape;
    }
    car.x -= scratch.rx * push;
    car.z -= scratch.rz * push;
    projectInto(track, car.x, car.z, car.hint, scratch);
    car.hint = scratch.sampleIndex;
  }

  const edge = Math.max(1, scratch.width * 0.5 - 1.15);
  const pressure = Math.max(0, Math.abs(scratch.lat) / edge - 0.86);
  if (pressure > 0) {
    const along = car.vx * scratch.tx + car.vz * scratch.tz;
    const loss = Math.min(Math.abs(along), Math.abs(along) * pressure * 7 * dt + pressure * 22 * dt);
    if (loss > 0 && Math.abs(along) > 0.1) {
      const dir = Math.sign(along);
      car.vx -= scratch.tx * dir * loss;
      car.vz -= scratch.tz * dir * loss;
      if (pressure > 0.2) car.crashPulse = Math.max(car.crashPulse, Math.min(0.6, pressure));
    }
  }

  const roadY = scratch.y;
  if (!car.airborne && scratch.jump && !car.wasJump && forwardSpeed > 34) {
    car.airborne = true;
    car.vy = 6.2 + Math.max(0, forwardSpeed) * 0.045;
  }
  car.wasJump = scratch.jump;

  if (car.airborne) {
    car.vy -= 27 * dt;
    car.y += car.vy * dt;
    if (car.y <= roadY) {
      if (car.vy < -3.5) car.crashPulse = Math.max(car.crashPulse, Math.min(1, -car.vy / 16));
      car.y = roadY;
      car.vy = 0;
      car.airborne = false;
    }
  } else {
    car.y += (roadY - car.y) * Math.min(1, dt * 14);
    car.vy = 0;
  }

  let delta = scratch.arc - car.arc;
  if (car.arcReady) {
    if (delta < -track.length * 0.5) delta += track.length;
    if (delta > track.length * 0.5) delta -= track.length;
    car.raceDist += delta;
  }
  car.arcReady = true;
  car.arc = scratch.arc;

  const ffx = -Math.sin(car.yaw);
  const ffz = -Math.cos(car.yaw);
  car.forwardSpeed = car.vx * ffx + car.vz * ffz;
  car.latVel = car.vx * Math.cos(car.yaw) + car.vz * -Math.sin(car.yaw);
  car.slip = Math.abs(car.latVel);
  car.longAccel = longAccel;
  car.latAccel = latAccel;
  car.latOff = scratch.lat;
  car.roadHalf = scratch.width * 0.5;
  car.steerVisual = input.steer;
  car.throttleVisual = input.throttle;
  car.brakeVisual = input.brake;
  car.boosting = boosting;
  car.crashPulse *= Math.exp(-dt * 4.5);
  car.wheelSpin += (car.forwardSpeed / 0.38) * dt;

  const poseK = 1 - Math.exp(-dt * 8);
  const targetPitch = clamp(longAccel * PRESENT.pitchGain, -0.09, 0.11);
  const targetRoll = clamp(-latAccel * PRESENT.rollGain, -0.14, 0.14);
  car.bodyPitch += (targetPitch - car.bodyPitch) * poseK;
  car.bodyRoll += (targetRoll - car.bodyRoll) * poseK;
}
