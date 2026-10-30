import { clamp, wrapAngle } from "./math";
import { APEX, trackById, type GridSpec, type TrackDefinition, type WidthSpec } from "./track-def";

const SCALE = 1;

export type Sample = {
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  tz: number;
  rx: number;
  rz: number;
  dist: number;
  segLen: number;
  width: number;
  curv: number;
  /** Meters along the right vector. Positive is right. Apex sits inside the turn. */
  line: number;
  /** Grip-limited speed in m/s for this curvature, before a driver's pace. */
  speed: number;
  jump: boolean;
};

export type Gate = {
  id: number;
  x: number;
  y: number;
  z: number;
  tx: number;
  tz: number;
  rx: number;
  rz: number;
  half: number;
  sampleIndex: number;
  arc: number;
  next: number;
};

export type Track = {
  id: string;
  name: string;
  laps: number;
  referenceSpeed: number;
  grid: GridSpec;
  themeId: string;
  samples: Sample[];
  gates: Gate[];
  length: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY: number;
};

export type Projection = {
  sampleIndex: number;
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  tz: number;
  rx: number;
  rz: number;
  lat: number;
  arc: number;
  width: number;
  curv: number;
  jump: boolean;
};

function catmull(
  p0: readonly [number, number, number],
  p1: readonly [number, number, number],
  p2: readonly [number, number, number],
  p3: readonly [number, number, number],
  t: number,
): [number, number, number] {
  const t2 = t * t;
  const t3 = t2 * t;
  const axis = (i: 0 | 1 | 2) =>
    0.5 *
    (2 * p1[i] +
      (-p0[i] + p2[i]) * t +
      (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 +
      (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3);
  return [axis(0), axis(1), axis(2)];
}

export function buildTrack(): Track {
  return buildFromDefinition(APEX);
}

export function buildCourse(id: string): Track {
  return buildFromDefinition(trackById(id));
}

export function buildFromDefinition(def: TrackDefinition): Track {
  return buildSpline(def.points, {
    scale: SCALE,
    jumpSegment: def.jumpSegment,
    width: def.width,
    id: def.id,
    name: def.name,
    laps: def.laps,
    referenceSpeed: def.referenceSpeed,
    grid: def.grid,
    themeId: def.themeId,
  });
}

/** Flat proving ground: straight, brake-in, hairpin, slalom, sweeper, drift corner. */
const PAD: ReadonlyArray<readonly [number, number, number]> = [
  [-30, 0, 0],
  [90, 0, 0],
  [230, 0, 0],
  [390, 0, 2],
  [510, 0, 28],
  [575, 0, 110],
  [520, 0, 190],
  [400, 0, 230],
  [270, 0, 200],
  [190, 0, 265],
  [115, 0, 205],
  [45, 0, 268],
  [-20, 0, 205],
  [-85, 0, 250],
  [-170, 0, 195],
  [-250, 0, 110],
  [-265, 0, 20],
  [-190, 0, -36],
  [-80, 0, -8],
];

export function buildPad(): Track {
  return buildSpline(PAD, {
    scale: 1,
    width: { base: 26, tighten: 0, min: 26, max: 26 },
    id: "pad",
    name: "PAD",
    laps: 1,
    referenceSpeed: 52,
    grid: { holdBack: 20, rowGap: 8, lat: 0 },
    themeId: "pad",
  });
}

function buildSpline(
  raw: ReadonlyArray<readonly [number, number, number]>,
  opts: {
    scale: number;
    jumpSegment?: number;
    width: WidthSpec;
    id: string;
    name: string;
    laps: number;
    referenceSpeed: number;
    grid: GridSpec;
    themeId: string;
  },
): Track {
  const nCtrl = raw.length;
  const sps = 12;
  const pts: [number, number, number][] = [];
  const jump: boolean[] = [];
  for (let i = 0; i < nCtrl; i++) {
    const p0 = raw[(i - 1 + nCtrl) % nCtrl]!;
    const p1 = raw[i]!;
    const p2 = raw[(i + 1) % nCtrl]!;
    const p3 = raw[(i + 2) % nCtrl]!;
    for (let s = 0; s < sps; s++) {
      const p = catmull(p0, p1, p2, p3, s / sps);
      pts.push([p[0] * opts.scale, p[1], p[2] * opts.scale]);
      jump.push(opts.jumpSegment != null && i === opts.jumpSegment && s > sps * 0.45);
    }
  }

  const n = pts.length;
  const samples: Sample[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    const tx = dx / len;
    const ty = dy / len;
    const tz = dz / len;
    let rx = -tz;
    let rz = tx;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl;
    rz /= rl;
    samples.push({
      x: a[0],
      y: a[1],
      z: a[2],
      tx,
      ty,
      tz,
      rx,
      rz,
      dist: 0,
      segLen: len,
      width: 16,
      curv: 0,
      line: 0,
      speed: opts.referenceSpeed,
      jump: jump[i] ?? false,
    });
  }

  let acc = 0;
  for (let i = 0; i < n; i++) {
    const s = samples[i]!;
    s.dist = acc;
    acc += s.segLen;
    const nxt = samples[(i + 1) % n]!;
    const a0 = Math.atan2(s.tx, s.tz);
    const a1 = Math.atan2(nxt.tx, nxt.tz);
    s.curv = wrapAngle(a1 - a0) / Math.max(0.5, s.segLen);
    s.width = clamp(opts.width.base - Math.abs(s.curv) * opts.width.tighten, opts.width.min, opts.width.max);
    s.speed = gripCornerSpeed(s.curv, opts.referenceSpeed);
  }
  applyRacingLine(samples);

const gates: Gate[] = [];
  const step = Math.max(1, Math.round(n / 8));
  for (let s = step; s < n; s += step) gates.push(makeGate(samples[s]!, s, gates.length));
  gates.push(makeGate(samples[0]!, 0, gates.length));
  for (let i = 0; i < gates.length; i++) gates[i]!.next = (i + 1) % gates.length;

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minY = Infinity;
  for (const s of samples) {
    minX = Math.min(minX, s.x);
    maxX = Math.max(maxX, s.x);
    minZ = Math.min(minZ, s.z);
    maxZ = Math.max(maxZ, s.z);
    minY = Math.min(minY, s.y);
  }

  return {
    id: opts.id,
    name: opts.name,
    laps: opts.laps,
    referenceSpeed: opts.referenceSpeed,
    grid: opts.grid,
    themeId: opts.themeId,
    samples,
    gates,
    length: acc,
    minX,
    maxX,
    minZ,
    maxZ,
    minY,
  };
}

/** Lateral accel the current tire model can hold without riding the wall. */
function gripCornerSpeed(curv: number, referenceSpeed: number): number {
  const k = Math.max(Math.abs(curv), 0.0015);
  return Math.min(referenceSpeed * 0.98, Math.sqrt(8.3 / k));
}

/**
 * Outside, then apex, then track-out. Positive curvature is a left turn and
 * the stored right-vector points to the outside of that turn, so the apex
 * offset is negative.
 */
function applyRacingLine(samples: Sample[]): void {
  const n = samples.length;
  const raw = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let peak = samples[i]!.curv;
    let peakAbs = Math.abs(peak);
    let peakAt = 0;
    let acc = 0;
    for (let k = 1; k <= 48; k++) {
      acc += samples[(i + k - 1) % n]!.segLen;
      if (acc > 78) break;
      const s = samples[(i + k) % n]!;
      const a = Math.abs(s.curv);
      if (a > peakAbs) {
        peakAbs = a;
        peak = s.curv;
        peakAt = acc;
      }
    }
    acc = 0;
    for (let k = 1; k <= 36; k++) {
      const s = samples[(i - k + n) % n]!;
      acc += s.segLen;
      if (acc > 52) break;
      const a = Math.abs(s.curv);
      if (a > peakAbs + 0.001) {
        peakAbs = a;
        peak = s.curv;
        peakAt = -acc;
      }
    }
    const here = samples[i]!;
    const hereAbs = Math.abs(here.curv);
    if (hereAbs > 0.0045 && hereAbs >= peakAbs * 0.75) {
      peak = here.curv;
      peakAbs = hereAbs;
      peakAt = 0;
    }
    const w = here.width * 0.22;
    const sign = Math.sign(peak) || 0;
    const inside = -sign * w;
    const outside = sign * w;
    let offset = 0;
    if (peakAbs > 0.0042) {
      const d = peakAt;
      if (d > 46) offset = outside * 0.25;
      else if (d > 18) offset = outside;
      else if (d > 2) offset = outside + (inside - outside) * ((18 - d) / 16);
      else if (d > -14) offset = inside + (outside * 0.85 - inside) * clamp((2 - d) / 16, 0, 1);
      else if (d > -36) offset = outside * 0.85 * (1 - clamp((-14 - d) / 22, 0, 1));
    }
    raw[i] = offset;
  }
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let weight = 0;
    for (let k = -3; k <= 3; k++) {
      const wgt = k === 0 ? 4 : 4 - Math.abs(k);
      sum += raw[(i + k + n) % n]! * wgt;
      weight += wgt;
    }
    samples[i]!.line = sum / weight;
  }
}

function makeGate(s: Sample, sampleIndex: number, id: number): Gate {
  return {
    id,
    x: s.x,
    y: s.y,
    z: s.z,
    tx: s.tx,
    tz: s.tz,
    rx: s.rx,
    rz: s.rz,
    half: Math.max(9, s.width * 0.62),
    sampleIndex,
    arc: s.dist,
    next: 0,
  };
}

export function sampleIndexAt(track: Track, arc: number): number {
  const n = track.samples.length;
  let a = arc % track.length;
  if (a < 0) a += track.length;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (track.samples[mid]!.dist <= a) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function sampleAt(track: Track, arc: number): Sample {
  return track.samples[sampleIndexAt(track, arc)]!;
}

function segScore(
  s: Sample,
  x: number,
  z: number,
): { d2: number; t: number; lat: number; px: number; py: number; pz: number } {
  const n = s.segLen || 1;
  const abx = s.tx * n;
  const abz = s.tz * n;
  const abl2 = abx * abx + abz * abz || 1;
  const t = clamp(((x - s.x) * abx + (z - s.z) * abz) / abl2, 0, 1);
  const px = s.x + abx * t;
  const pz = s.z + abz * t;
  const py = s.y + s.ty * n * t;
  const lx = x - px;
  const lz = z - pz;
  const lat = lx * s.rx + lz * s.rz;
  return { d2: lx * lx + lz * lz, t, lat, px, py, pz };
}

export function projectInto(
  track: Track,
  x: number,
  z: number,
  hint: number,
  out: Projection,
): void {
  const samples = track.samples;
  const n = samples.length;
  let bestI = 0;
  let bestD = Infinity;
  let best = segScore(samples[0]!, x, z);

  const consider = (i: number) => {
    const sc = segScore(samples[i]!, x, z);
    if (sc.d2 < bestD) {
      bestD = sc.d2;
      bestI = i;
      best = sc;
    }
  };

  if (hint >= 0) {
    for (let k = -18; k <= 18; k++) consider((hint + k + n) % n);
    if (bestD > 40 * 40) {
      for (let i = 0; i < n; i++) consider(i);
    }
  } else {
    for (let i = 0; i < n; i++) consider(i);
  }

  const s = samples[bestI]!;
  const arc = s.dist + s.segLen * best.t;
  out.sampleIndex = bestI;
  out.x = best.px;
  out.y = best.py;
  out.z = best.pz;
  out.tx = s.tx;
  out.ty = s.ty;
  out.tz = s.tz;
  out.rx = s.rx;
  out.rz = s.rz;
  out.lat = best.lat;
  out.arc = arc >= track.length ? arc - track.length : arc;
  out.width = s.width;
  out.curv = s.curv;
  out.jump = s.jump;
}
