import { clamp } from "./math";
import { VECTOR, type VehicleDefinition } from "./vehicle-def";

/** Longitudinal curve. Past the peak, wheelspin and lockup give up force. */
export function gripShape(slip: number): number {
  const a = slip > 0 ? slip : 0;
  if (a <= 1) return a * (2 - a);
  const extra = a - 1;
  return 0.3 + 0.7 / (1 + extra * extra * 1.55);
}

/** Lateral curve. Peaks at 1, then declines so more lock does not make more cornering force. */
export function lateralShape(slip: number): number {
  const a = slip > 0 ? slip : 0;
  if (a <= 1) return a * (2 - a);
  const extra = a - 1;
  return 0.42 + 0.58 / (1 + extra * extra * 0.85);
}

export type TireRequest = {
  forward: number;
  lateral: number;
  yawRate: number;
  steer: number;
  steerSens: number;
  driveDemand: number;
  brakeDemand: number;
  boostBlend: number;
  airborne: boolean;
  longSlip: number;
  longAccel: number;
  latAccel: number;
  lift: number;
  dt: number;
};

export type TireResult = {
  drive: number;
  lat: number;
  yawAccel: number;
  longSlip: number;
  latSlip: number;
  rearSlip: number;
  longUse: number;
  latUse: number;
  frontUse: number;
  rearUse: number;
  frontLoad: number;
  rearLoad: number;
  wheelspin: number;
};

const result: TireResult = {
  drive: 0,
  lat: 0,
  yawAccel: 0,
  longSlip: 0,
  latSlip: 0,
  rearSlip: 0,
  longUse: 0,
  latUse: 0,
  frontUse: 0,
  rearUse: 0,
  frontLoad: 0.5,
  rearLoad: 0.5,
  wheelspin: 0,
};

function eat(sat: number, weight: number): number {
  const x = sat * weight;
  const c = x < 0 ? 0 : x > 1 ? 1 : x;
  return Math.sqrt(Math.max(0.15, 1 - c * c));
}

export function evalTires(req: TireRequest, def: VehicleDefinition = VECTOR): TireResult {
  const speed = Math.abs(req.forward);
  const reverse = req.forward < -0.8;
  const steerScale =
    def.steerFloor + (1 - def.steerFloor) / (1 + (speed / def.steerFalloff) ** def.steerCurve);
  const steerAng = req.steer * def.maxSteer * steerScale * req.steerSens * (reverse ? -1 : 1);

  const longDf = 1 + (def.downforce * speed * speed) / 4200;
  const latDf = 1 + (def.latDownforce * speed * speed) / 4200;
  const air = req.airborne ? def.airGrip : 1;

  let frontLoad = 0.5 - clamp(req.longAccel * def.loadTransfer, -def.loadClamp, def.loadClamp);
  frontLoad = clamp(frontLoad + req.lift * def.liftFront, 0.3, 0.7);
  const rearLoad = 1 - frontLoad;
  const latLoss = 1 - Math.min(0.12, Math.abs(req.latAccel) * def.latUnload);

  const peakLat = def.slipPeak + def.slipWiden / (1 + speed / def.slipWidenSpeed);
  const frontPeak = peakLat * def.frontPeakMul;
  const rearPeak = peakLat * def.rearPeakMul;

  const vFront = req.lateral - req.yawRate * def.axleFront;
  const vRear = req.lateral + req.yawRate * def.axleRear;
  const uRef = speed > 6 ? speed : 6;
  let slipF = Math.atan2(vFront, uRef) + steerAng;
  let slipR = Math.atan2(vRear, uRef);
  if (slipF > 1.2) slipF = 1.2;
  else if (slipF < -1.2) slipF = -1.2;
  if (slipR > 1.2) slipR = 1.2;
  else if (slipR < -1.2) slipR = -1.2;

  const normF = slipF / frontPeak;
  const normR = slipR / rearPeak;
  const latSat = Math.max(Math.abs(normF), Math.abs(normR));

  const longLoad = def.longGrip * longDf * air;
  const longCap = longLoad * eat(latSat, def.latCombine);
  const net = req.driveDemand - req.brakeDemand;
  const ratio = net / (longCap > 0.8 ? longCap : 0.8);
  const low =
    1 +
    (def.lowSpin - 1) * clamp(1 - speed / def.lowSpinSpeed, 0, 1) +
    req.boostBlend * def.boostSpin * clamp(1 - speed / 16, 0, 1);
  const scaled = ratio * low;
  const mag = Math.abs(scaled);
  let target = mag <= 1 ? mag * 0.92 : Math.min(2.7, 1 + (mag - 1) * def.spinRate);
  if (scaled < 0) target = -target;

  const relax = 1 - Math.exp(-req.dt / def.slipRelax);
  const longSlip = req.longSlip + (target - req.longSlip) * relax;
  const curve = gripShape(Math.abs(longSlip)) * longCap;
  const want = Math.abs(net);
  const drive = (net < 0 ? -1 : net > 0 ? 1 : 0) * (want < curve ? want : curve);

  const sat = Math.abs(longSlip);
  const driving = net >= 0;
  const frontEat = eat(sat, driving ? def.longCombineDriveFront : def.longCombineBrakeFront);
  const rearEat = eat(sat, driving ? def.longCombineDriveRear : def.longCombineBrakeRear);
  const frontCap =
    def.latGrip * def.frontShare * latDf * air * frontEat * (frontLoad / 0.5) * latLoss;
  const rearCap = def.latGrip * def.rearShare * latDf * air * rearEat * (rearLoad / 0.5) * latLoss;
  const fyF = (slipF < 0 ? 1 : slipF > 0 ? -1 : 0) * lateralShape(Math.abs(normF)) * frontCap;
  const fyR = (slipR < 0 ? 1 : slipR > 0 ? -1 : 0) * lateralShape(Math.abs(normR)) * rearCap;
  const lat = fyF + fyR;

  let yawAccel = (-fyF * def.axleFront + fyR * def.axleRear) / def.yawInertia;
  const assist = clamp((def.yawAssistEnd - speed) / def.yawAssistEnd, 0, 1);
  const airYaw = req.airborne ? def.airGrip : 1;
  yawAccel += req.steer * def.yawAssist * assist * (reverse ? -1 : 1) * airYaw;
  yawAccel -= req.yawRate * (def.yawDamp + speed * def.yawDampSpeed);

  const staticLong = longLoad > 0.5 ? longLoad : 0.5;
  result.drive = drive;
  result.lat = lat;
  result.yawAccel = yawAccel;
  result.longSlip = longSlip;
  result.latSlip = normF;
  result.rearSlip = normR;
  result.longUse = clamp(Math.abs(drive) / staticLong, 0, 1.4);
  result.frontUse = Math.abs(normF);
  result.rearUse = Math.abs(normR);
  result.latUse = Math.max(result.frontUse, result.rearUse);
  result.frontLoad = frontLoad;
  result.rearLoad = rearLoad;
  result.wheelspin = net > 0 && longSlip > 0.95 ? clamp((longSlip - 0.95) / 1.15, 0, 1) : 0;
  return result;
}
