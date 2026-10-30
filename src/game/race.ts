import { sampleAt, type Track } from "./track";
import type { CarState } from "./types";
import { applyLaunch } from "./vehicle";

/** How far the car is between the previous checkpoint and the next, 0..1. */
export function sectorProgress(car: CarState, track: Track): number {
  const n = track.gates.length;
  if (n === 0) return 0;
  if (car.forwardSpeed < -2) return 0;
  const next = track.gates[car.nextGate];
  const prev = track.gates[(car.nextGate - 1 + n) % n];
  if (!next || !prev) return 0;
  let span = next.arc - prev.arc;
  if (span <= 1) span += track.length;
  let along = car.arc - prev.arc;
  if (along < -0.5) along += track.length;
  if (along < 0 || along > span) return 0;
  const t = along / span;
  return t > 0.999 ? 0.999 : t;
}

export function checkGate(car: CarState, track: Track): "none" | "gate" | "lap" {
  const g = track.gates[car.nextGate];
  if (!g) return "none";
  const d0 = (car.prevX - g.x) * g.tx + (car.prevZ - g.z) * g.tz;
  const d1 = (car.x - g.x) * g.tx + (car.z - g.z) * g.tz;
  if (!(d0 < 0 && d1 >= 0)) return "none";
  const lat = (car.x - g.x) * g.rx + (car.z - g.z) * g.rz;
  if (Math.abs(lat) > g.half + 3.5) return "none";
  const finish = car.nextGate === track.gates.length - 1;
  car.respawnArc = car.arc;
  if (finish) {
    car.nextGate = 0;
    return "lap";
  }
  car.nextGate += 1;
  return "gate";
}

export function respawnCar(car: CarState, track: Track): void {
  const arc = car.respawnArc + 8;
  const s = sampleAt(track, arc);
  let drop = car.arc - s.dist;
  if (drop > track.length * 0.5) drop -= track.length;
  if (drop < -track.length * 0.5) drop += track.length;
  car.raceDist -= drop;
  car.x = s.x;
  car.y = s.y;
  car.z = s.z;
  car.yaw = Math.atan2(-s.tx, -s.tz);
  applyLaunch(car, 20);
  car.vy = 0;
  car.airborne = false;
  car.stuck = 0;
  car.hint = -1;
  car.prevX = car.x;
  car.prevZ = car.z;
  car.crashPulse = Math.max(car.crashPulse, 0.25);
  car.arc = s.dist;
}

/** Capsule along the car: long enough for a nose-to-tail hit, narrow enough to pass side by side. */
const BODY_HALF = 1.46;
const BODY_RAD = 0.98;
const YAW_INERTIA = 2.45;

function segClosest(
  a0x: number,
  a0z: number,
  a1x: number,
  a1z: number,
  b0x: number,
  b0z: number,
  b1x: number,
  b1z: number,
): { ax: number; az: number; bx: number; bz: number; dist: number } {
  const ux = a1x - a0x;
  const uz = a1z - a0z;
  const vx = b1x - b0x;
  const vz = b1z - b0z;
  const wx = a0x - b0x;
  const wz = a0z - b0z;
  const a = ux * ux + uz * uz || 1e-8;
  const b = ux * vx + uz * vz;
  const c = vx * vx + vz * vz || 1e-8;
  const d = ux * wx + uz * wz;
  const e = vx * wx + vz * wz;
  const denom = a * c - b * b;
  let sN: number;
  let sD = denom;
  let tN: number;
  let tD = denom;
  if (denom < 1e-6) {
    sN = 0;
    sD = 1;
    tN = e;
    tD = c;
  } else {
    sN = b * e - c * d;
    tN = a * e - b * d;
    if (sN < 0) {
      sN = 0;
      tN = e;
      tD = c;
    } else if (sN > sD) {
      sN = sD;
      tN = e + b;
      tD = c;
    }
  }
  if (tN < 0) {
    tN = 0;
    if (-d < 0) sN = 0;
    else if (-d > a) sN = sD;
    else {
      sN = -d;
      sD = a;
    }
  } else if (tN > tD) {
    tN = tD;
    if (-d + b < 0) sN = 0;
    else if (-d + b > a) sN = sD;
    else {
      sN = -d + b;
      sD = a;
    }
  }
  const sc = Math.abs(sN) < 1e-8 ? 0 : sN / sD;
  const tc = Math.abs(tN) < 1e-8 ? 0 : tN / tD;
  const cx = a0x + ux * sc;
  const cz = a0z + uz * sc;
  const dx = b0x + vx * tc;
  const dz = b0z + vz * tc;
  const ex = cx - dx;
  const ez = cz - dz;
  return { ax: cx, az: cz, bx: dx, bz: dz, dist: Math.hypot(ex, ez) };
}

function resolvePair(a: CarState, b: CarState): void {
  const afx = -Math.sin(a.yaw);
  const afz = -Math.cos(a.yaw);
  const bfx = -Math.sin(b.yaw);
  const bfz = -Math.cos(b.yaw);
  const hit = segClosest(
    a.x - afx * BODY_HALF,
    a.z - afz * BODY_HALF,
    a.x + afx * BODY_HALF,
    a.z + afz * BODY_HALF,
    b.x - bfx * BODY_HALF,
    b.z - bfz * BODY_HALF,
    b.x + bfx * BODY_HALF,
    b.z + bfz * BODY_HALF,
  );
  const pen = BODY_RAD * 2 - hit.dist;
  if (pen <= 0) return;

  let nx = hit.bx - hit.ax;
  let nz = hit.bz - hit.az;
  let nd = Math.hypot(nx, nz);
  if (nd < 1e-3) {
    nx = b.x - a.x;
    nz = b.z - a.z;
    nd = Math.hypot(nx, nz);
  }
  if (nd < 1e-3) {
    nx = afx || 0;
    nz = afz || 1;
    nd = Math.hypot(nx, nz) || 1;
  }
  nx /= nd;
  nz /= nd;

  const rAx = hit.ax - a.x;
  const rAz = hit.az - a.z;
  const rBx = hit.bx - b.x;
  const rBz = hit.bz - b.z;
  const vax = a.vx + a.yawRate * rAz;
  const vaz = a.vz - a.yawRate * rAx;
  const vbx = b.vx + b.yawRate * rBz;
  const vbz = b.vz - b.yawRate * rBx;
  const rel = (vax - vbx) * nx + (vaz - vbz) * nz;

  const deep = pen > 0.55 && rel < 0.35;
  const share = Math.min(0.42, (pen - 0.015) * (deep ? 0.72 : 0.5));
  if (share > 0) {
    a.x -= nx * share;
    a.z -= nz * share;
    b.x += nx * share;
    b.z += nz * share;
  }

  if (rel > 0.08) {
    const e = rel < 2.4 ? 0.03 : rel < 8 ? 0.09 : 0.14;
    const crossA = rAx * nz - rAz * nx;
    const crossB = rBx * nz - rBz * nx;
    const ang = (crossA * crossA + crossB * crossB) / YAW_INERTIA;
    let j = (rel * (1 + e)) / (2 + ang);
    const cap = 2.4 + rel * 0.42;
    if (j > cap) j = cap;
    a.vx -= nx * j;
    a.vz -= nz * j;
    b.vx += nx * j;
    b.vz += nz * j;
    let yawA = a.yawRate - (crossA * j) / YAW_INERTIA;
    let yawB = b.yawRate + (crossB * j) / YAW_INERTIA;
    if (yawA > 2.4) yawA = 2.4;
    else if (yawA < -2.4) yawA = -2.4;
    if (yawB > 2.4) yawB = 2.4;
    else if (yawB < -2.4) yawB = -2.4;
    a.yawRate = yawA;
    b.yawRate = yawB;

    const align = Math.abs(nx * afx + nz * afz);
    if (align > 0.8 && rel > 9) {
      const bleed = Math.min(5.5, rel * 0.16);
      a.vx -= afx * bleed * 0.5;
      a.vz -= afz * bleed * 0.5;
      b.vx -= bfx * bleed * 0.5;
      b.vz -= bfz * bleed * 0.5;
    }

    const pulse = Math.min(1, rel / 14);
    a.crashPulse = Math.max(a.crashPulse, pulse);
    b.crashPulse = Math.max(b.crashPulse, pulse);
  }
}

/** Oriented body collision. Momentum moves; cars are not teleported and do not leave the ground. */
export function separateCars(cars: CarState[]): void {
  const n = cars.length;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) resolvePair(cars[i]!, cars[j]!);
    }
  }
}

/** Seconds the other car is ahead of the player. Negative means the other car is behind. */
export function timeGapSeconds(player: CarState, other: CarState): number {
  const delta = other.raceDist - player.raceDist;
  const pace = Math.max(22, (Math.abs(player.forwardSpeed) + Math.abs(other.forwardSpeed)) * 0.5);
  return delta / pace;
}

export function rankCars(cars: readonly CarState[]): CarState[] {
  return [...cars].sort((a, b) => {
    if (a.finished && b.finished) return a.finishPlace - b.finishPlace;
    if (a.finished) return -1;
    if (b.finished) return 1;
    const sa = a.laps * 1000 + a.nextGate + a.sector;
    const sb = b.laps * 1000 + b.nextGate + b.sector;
    return sb - sa;
  });
}
