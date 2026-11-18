import * as THREE from "three";
import { WHEEL_CONTACT_Y } from "./contact";
import type { CarDims, CarId, CarRole, WheelLayout } from "./car-model";

/**
 * Each car is a closed loft of its own cross-section, not a stack of boxes.
 * The section changes along the car: a GT hood sits between raised fenders, a
 * sedan roof stays wide and flat, and the prototype's nose drops into a valley
 * between enclosed wheel pods. Wheel anchors come from the physics layout.
 * +Z nose, -Z tail, +X driver's left, +Y up, origin on the tire contact plane.
 */

type Pt = [number, number];
type Keys = Array<[number, number]>;
type RoleName = CarRole;

const ROLES: RoleName[] = [
  "paint",
  "carbon",
  "glass",
  "dark",
  "well",
  "accent",
  "lamp",
  "tail",
  "chrome",
];

type Bucket = { pos: number[]; nrm: number[] };

function curve(keys: Keys, z: number): number {
  if (z <= keys[0]![0]) return keys[0]![1];
  const last = keys[keys.length - 1]!;
  if (z >= last[0]) return last[1];
  let i = 0;
  while (keys[i + 1]![0] < z) i++;
  const z0 = keys[i]![0];
  const z1 = keys[i + 1]![0];
  const t = (z - z0) / (z1 - z0);
  const s = t * t * (3 - 2 * t);
  return keys[i]![1] + (keys[i + 1]![1] - keys[i]![1]) * s;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function archAmount(z: number, axleZ: number, radius: number): number {
  // Only the middle of the tire is an opening. Ahead of it the fender is a solid face.
  const reach = radius * 1.15;
  const u = Math.abs(z - axleZ) / reach;
  if (u >= 1) return 0;
  return Math.cos(u * Math.PI * 0.5);
}

type Shape = {
  id: CarId;
  z0: number;
  z1: number;
  samples: number;
  round: number;
  /** 0 = arch lip near the hub, 1 = bodywork wraps down around the tire. */
  enclose: number;
  halfW: Keys;
  floor: Keys;
  sill: Keys;
  belt: Keys;
  crown: Keys;
  roofHalf: Keys;
  tireHalf: { front: number; rear: number };
  glassZ: [number, number];
  roofZ: [number, number];
  pillars: number[];
  grille: { half: number; top: number };
  canopy?: [number, number];
};

function halfLoop(half: Pt[]): Pt[] {
  const loop = half.slice();
  for (let i = half.length - 2; i >= 1; i--) loop.push([-half[i]![0], half[i]![1]]);
  return loop;
}

function sectionAt(shape: Shape, layout: WheelLayout, z: number): Pt[] {
  const halfW = curve(shape.halfW, z);
  const floor = curve(shape.floor, z);
  const sill = Math.min(curve(shape.sill, z), curve(shape.belt, z) - 0.03);
  const belt = curve(shape.belt, z);
  const crown = curve(shape.crown, z);
  const roofHalf = Math.max(0.02, Math.min(curve(shape.roofHalf, z), halfW * 0.96));
  const round = shape.round;
  const frontA = archAmount(z, layout.frontZ, layout.frontRadius);
  const rearA = archAmount(z, layout.rearZ, layout.rearRadius);
  const useRear = rearA >= frontA;
  const arch = Math.max(frontA, rearA);
  const track = useRear ? layout.rearX : layout.frontX;
  const radius = useRear ? layout.rearRadius : layout.frontRadius;
  const tireHalf = useRear ? shape.tireHalf.rear : shape.tireHalf.front;
  const wheelY = WHEEL_CONTACT_Y + radius;
  const archTop = wheelY + radius + 0.09;
  const inner = Math.max(0.08, track - tireHalf - 0.06);

  const tShoulder = 0.1 + round * 0.4;
  const yShoulder = 0.14 + round * 0.42;
  const beltC = Math.max(belt, sill + 0.04);
  const crownC = Math.max(crown, beltC + 0.05);
  const normal: Pt[] = [
    [0, floor],
    [halfW * 0.2, floor + 0.012],
    [halfW * 0.48, floor + 0.026],
    [halfW * 0.76, sill],
    [halfW * 0.93, lerp(sill, beltC, 0.42)],
    [halfW, lerp(sill, beltC, 0.8)],
    [halfW * (1 - 0.015 * round), beltC],
    [lerp(halfW, roofHalf, tShoulder), lerp(beltC, crownC, yShoulder)],
    [lerp(halfW * 0.7, roofHalf, 0.5 + round * 0.25), lerp(beltC, crownC, 0.42 + round * 0.28)],
    [roofHalf, lerp(beltC, crownC, 0.9)],
    [roofHalf * 0.42, crownC - 0.01 * (1 - round)],
    [0, crownC],
  ];
  // Smooth arch: the rocker tucks inboard of the tire and the shoulder rises
  // outboard over the tread. Y keeps climbing, so the section does not fold.
  const outerLip = track + tireHalf + 0.06;
  const lipY = Math.max(floor + 0.06, wheelY - radius * (0.08 + shape.enclose * 0.35));
  return normal.map((p, i) => {
    if (arch <= 0) return p;
    if (i <= 4) {
      const tuck = inner * (0.45 + 0.55 * (i / 4));
      const y = i === 0 ? p[1] : lerp(p[1], lipY * (0.55 + 0.45 * (i / 4)), arch);
      return [lerp(p[0], Math.min(p[0], tuck), arch), y] as Pt;
    }
    if (i <= 6) {
      const y = lerp(p[1], archTop, arch * (i === 6 ? 1 : 0.72));
      const x = lerp(p[0], outerLip * (i === 5 ? 0.96 : 1), arch);
      return [x, y] as Pt;
    }
    return p;
  });
}

function roleAt(shape: Shape, _x: number, y: number, z: number): RoleName {
  // One paint skin. A carbon/paint cut along the belly reads as a sawtooth, so the
  // splitter and diffuser stay in the dress-up parts instead.
  void shape;
  void y;
  void z;
  return "paint";
}

function emptyBuckets(): Record<RoleName, Bucket> {
  return {
    paint: { pos: [], nrm: [] },
    carbon: { pos: [], nrm: [] },
    glass: { pos: [], nrm: [] },
    dark: { pos: [], nrm: [] },
    well: { pos: [], nrm: [] },
    accent: { pos: [], nrm: [] },
    lamp: { pos: [], nrm: [] },
    tail: { pos: [], nrm: [] },
    chrome: { pos: [], nrm: [] },
  };
}

function absorb(bucket: Bucket, geometry: THREE.BufferGeometry): void {
  const geo = geometry.getIndex() ? geometry.toNonIndexed() : geometry;
  if (!geo.getAttribute("normal")) geo.computeVertexNormals();
  const pos = geo.getAttribute("position");
  const nrm = geo.getAttribute("normal");
  for (let i = 0; i < pos.count; i++) {
    bucket.pos.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    bucket.nrm.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
  }
  if (geo !== geometry) geo.dispose();
}

function loftLoops(
  bucketFor: (x: number, y: number, z: number) => Bucket,
  rings: Array<{ z: number; loop: Pt[] }>,
  nose: Pt,
  tail: Pt,
): void {
  const n = rings[0]!.loop.length;
  const count = rings.length;
  const pos = new Float32Array((count * n + 2) * 3);
  let w = 0;
  for (const ring of rings) {
    for (const p of ring.loop) {
      pos[w++] = p[0];
      pos[w++] = p[1];
      pos[w++] = ring.z;
    }
  }
  const tailTip = count * n;
  const noseTip = tailTip + 1;
  const tailZ = rings[0]!.z;
  const noseZ = rings[count - 1]!.z;
  pos[w++] = tail[0];
  pos[w++] = tail[1];
  pos[w++] = tailZ - 0.004;
  pos[w++] = nose[0];
  pos[w++] = nose[1];
  pos[w++] = noseZ + 0.004;
  const index: number[] = [];
  for (let r = 0; r < count - 1; r++) {
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n;
      const a = r * n + i;
      const b = r * n + i2;
      const c = (r + 1) * n + i2;
      const d = (r + 1) * n + i;
      index.push(a, b, c, a, c, d);
    }
  }
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    index.push(tailTip, i2, i);
    const base = (count - 1) * n;
    index.push(noseTip, base + i, base + i2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const nrm = geo.getAttribute("normal");
  const tri = geo.getIndex()!;
  for (let t = 0; t < tri.count; t += 3) {
    const ia = tri.getX(t);
    const ib = tri.getX(t + 1);
    const ic = tri.getX(t + 2);
    const cx = (pos[ia * 3]! + pos[ib * 3]! + pos[ic * 3]!) / 3;
    const cy = (pos[ia * 3 + 1]! + pos[ib * 3 + 1]! + pos[ic * 3 + 1]!) / 3;
    const cz = (pos[ia * 3 + 2]! + pos[ib * 3 + 2]! + pos[ic * 3 + 2]!) / 3;
    const bucket = bucketFor(cx, cy, cz);
    for (const idx of [ia, ib, ic]) {
      bucket.pos.push(pos[idx * 3]!, pos[idx * 3 + 1]!, pos[idx * 3 + 2]!);
      bucket.nrm.push(nrm.getX(idx), nrm.getY(idx), nrm.getZ(idx));
    }
  }
  geo.dispose();
}

function foil(chord: number, thick: number): Pt[] {
  const n = 11;
  const yt = (t: number) =>
    (thick / 0.2) *
    (0.2969 * Math.sqrt(Math.max(t, 1e-4)) -
      0.126 * t -
      0.3516 * t * t +
      0.2843 * t * t * t -
      0.1015 * t * t * t * t);
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([-chord * t, yt(t)]);
  }
  for (let i = n - 1; i >= 1; i--) {
    const t = i / n;
    pts.push([-chord * t, -yt(t) * 0.62]);
  }
  return pts;
}

function addWing(
  buckets: Record<RoleName, Bucket>,
  span: number,
  chord: number,
  thick: number,
  y: number,
  z: number,
  deckY: number,
): void {
  const section = foil(chord, thick);
  const rings: Array<{ z: number; loop: Pt[] }> = [];
  const stations = 7;
  for (let i = 0; i < stations; i++) {
    const t = i / (stations - 1);
    const x = lerp(-span / 2, span / 2, t);
    const lift = Math.sin(t * Math.PI) * 0.012;
    rings.push({ z: x, loop: section.map((p) => [p[0], p[1] + y + lift]) });
  }
  const wing = new THREE.BufferGeometry();
  const n = section.length;
  const pos = new Float32Array(stations * n * 3);
  let w = 0;
  for (const ring of rings) {
    for (const p of ring.loop) {
      pos[w++] = ring.z;
      pos[w++] = p[1];
      pos[w++] = p[0] + z;
    }
  }
  const index: number[] = [];
  for (let r = 0; r < stations - 1; r++) {
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n;
      const a = r * n + i;
      const b = r * n + i2;
      const c = (r + 1) * n + i2;
      const d = (r + 1) * n + i;
      index.push(a, d, b, b, d, c);
    }
  }
  wing.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  wing.setIndex(index);
  wing.computeVertexNormals();
  absorb(buckets.carbon, wing);
  wing.dispose();
  const plateH = Math.max(0.18, y + thick * 0.5 - deckY + 0.02);
  const plateY = deckY + plateH / 2;
  for (const side of [-1, 1]) {
    const plate = endplate(0.045, Math.max(0.3, chord * 0.9), plateH);
    plate.translate(side * (span / 2 - 0.02), plateY, z - chord * 0.32);
    absorb(buckets.carbon, plate);
    plate.dispose();
    addPylon(buckets, side * span * 0.28, deckY + 0.01, y - 0.01, z - chord * 0.15);
  }
}

function endplate(halfThick: number, chord: number, height: number): THREE.BufferGeometry {
  const r = Math.min(0.03, height * 0.15);
  const loop: Pt[] = [];
  const corner = (cx: number, cy: number, a0: number, a1: number) => {
    for (let i = 0; i <= 3; i++) {
      const a = lerp(a0, a1, i / 3);
      loop.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  };
  const hw = chord / 2 - r;
  const hh = height / 2 - r;
  corner(hw, hh, 0, Math.PI / 2);
  corner(-hw, hh, Math.PI / 2, Math.PI);
  corner(-hw, -hh, Math.PI, Math.PI * 1.5);
  corner(hw, -hh, Math.PI * 1.5, Math.PI * 2);
  const geo = new THREE.BufferGeometry();
  const depth = halfThick * 2;
  const pos = new Float32Array(loop.length * 2 * 3);
  loop.forEach((p, i) => {
    pos[i * 3] = -depth / 2;
    pos[i * 3 + 1] = p[1];
    pos[i * 3 + 2] = p[0];
    const j = loop.length + i;
    pos[j * 3] = depth / 2;
    pos[j * 3 + 1] = p[1];
    pos[j * 3 + 2] = p[0];
  });
  const index: number[] = [];
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    index.push(i, i2, n + i2, i, n + i2, n + i);
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

function addLens(
  buckets: Record<RoleName, Bucket>,
  role: RoleName,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
): void {
  const raw = new THREE.SphereGeometry(1, 14, 10);
  raw.scale(sx, sy, sz);
  raw.translate(x, y, z);
  absorb(buckets[role], raw);
  raw.dispose();
}

function addPylon(
  buckets: Record<RoleName, Bucket>,
  x: number,
  y0: number,
  y1: number,
  z: number,
): void {
  const height = Math.max(0.08, y1 - y0);
  const raw = new THREE.CylinderGeometry(0.032, 0.046, height, 12);
  raw.translate(x, y0 + height / 2, z);
  absorb(buckets.carbon, raw);
  raw.dispose();
}

function addPane(
  buckets: Record<RoleName, Bucket>,
  role: RoleName,
  w: number,
  h: number,
  x: number,
  y: number,
  z: number,
  rotX = 0,
  rotY = 0,
): void {
  const raw = new THREE.PlaneGeometry(w, h, 1, 1);
  if (rotX) raw.rotateX(rotX);
  if (rotY) raw.rotateY(rotY);
  raw.translate(x, y, z);
  absorb(buckets[role], raw);
  raw.dispose();
}

function addMirror(buckets: Record<RoleName, Bucket>, x: number, y: number, z: number): void {
  const pod = new THREE.SphereGeometry(1, 12, 8);
  pod.scale(0.07, 0.045, 0.11);
  pod.translate(x, y, z);
  absorb(buckets.dark, pod);
  pod.dispose();
  const glass = new THREE.SphereGeometry(1, 10, 6);
  glass.scale(0.055, 0.032, 0.02);
  glass.translate(x, y, z + 0.09);
  absorb(buckets.glass, glass);
  glass.dispose();
}

function addFin(
  buckets: Record<RoleName, Bucket>,
  z0: number,
  z1: number,
  y0: number,
  y1: number,
): void {
  const rings: Array<{ z: number; loop: Pt[] }> = [];
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const z = lerp(z0, z1, t);
    const base = lerp(y0, y0 + 0.08, t);
    const top = lerp(y1, y0 + 0.16, t * t);
    const half = 0.012 + 0.008 * (1 - t);
    rings.push({
      z,
      loop: [
        [-half, base],
        [half, base],
        [half * 0.7, top],
        [0, top + 0.01],
        [-half * 0.7, top],
      ],
    });
  }
  loftLoops(() => buckets.carbon, rings, [0, y0], [0, y0]);
}

function planarUv(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute("position");
  const nrm = geo.getAttribute("normal");
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nrm.getX(i));
    const ny = Math.abs(nrm.getY(i));
    const nz = Math.abs(nrm.getZ(i));
    const u = ny >= nx && ny >= nz ? pos.getX(i) : nx >= nz ? pos.getZ(i) : pos.getX(i);
    const v = ny >= nx && ny >= nz ? pos.getZ(i) : pos.getY(i);
    uv[i * 2] = u * 1.4;
    uv[i * 2 + 1] = v * 1.4;
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

function finish(
  buckets: Record<RoleName, Bucket>,
): Partial<Record<RoleName, THREE.BufferGeometry>> {
  const out: Partial<Record<RoleName, THREE.BufferGeometry>> = {};
  for (const role of ROLES) {
    const bucket = buckets[role];
    if (bucket.pos.length < 9) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(bucket.pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(bucket.nrm, 3));
    if (role === "carbon" || role === "paint") planarUv(geo);
    out[role] = geo;
  }
  return out;
}

const VECTOR: Shape = {
  id: "vector",
  z0: -2.16,
  z1: 2.22,
  samples: 64,
  round: 0.86,
  enclose: 0.38,
  tireHalf: { front: 0.13, rear: 0.15 },
  halfW: [
    [-2.16, 0.78],
    [-1.72, 0.98],
    [-1.35, 1.07],
    [-0.55, 0.92],
    [0.25, 0.9],
    [1.15, 1.03],
    [1.72, 0.96],
    [2.05, 0.9],
    [2.22, 0.82],
  ],
  floor: [
    [-2.16, 0.2],
    [-1.7, 0.12],
    [1.9, 0.12],
    [2.22, 0.16],
  ],
  sill: [
    [-2.16, 0.34],
    [-1.35, 0.4],
    [0.2, 0.42],
    [1.15, 0.4],
    [2.22, 0.36],
  ],
  belt: [
    [-2.16, 0.44],
    [-1.35, 0.56],
    [0, 0.66],
    [1.15, 0.58],
    [2.22, 0.48],
  ],
  crown: [
    [-2.16, 0.58],
    [-1.75, 0.66],
    [-1.35, 0.7],
    [-0.95, 1.0],
    [-0.3, 1.16],
    [0.16, 1.17],
    [0.48, 0.96],
    [0.78, 0.7],
    [1.2, 0.64],
    [1.75, 0.56],
    [2.22, 0.5],
  ],
  roofHalf: [
    [-2.16, 0.16],
    [-1.2, 0.34],
    [-0.25, 0.52],
    [0.2, 0.48],
    [0.65, 0.4],
    [1.25, 0.42],
    [1.85, 0.55],
    [2.22, 0.62],
  ],
  glassZ: [-1.18, 0.74],
  roofZ: [-0.42, 0.18],
  pillars: [0.46, -1.02],
  grille: { half: 0.38, top: 0.4 },
};

const VANTA: Shape = {
  id: "vanta",
  z0: -1.7,
  z1: 1.6,
  samples: 56,
  round: 0.8,
  enclose: 0.34,
  tireHalf: { front: 0.125, rear: 0.155 },
  halfW: [
    [-1.7, 0.7],
    [-1.3, 1.12],
    [-0.35, 0.96],
    [0.4, 0.94],
    [1.08, 1.04],
    [1.4, 0.9],
    [1.6, 0.78],
  ],
  floor: [
    [-1.7, 0.18],
    [-1.35, 0.12],
    [1.35, 0.12],
    [1.6, 0.16],
  ],
  sill: [
    [-1.7, 0.36],
    [-1.3, 0.42],
    [0.2, 0.44],
    [1.08, 0.4],
    [1.6, 0.3],
  ],
  belt: [
    [-1.7, 0.46],
    [-1.3, 0.56],
    [0, 0.64],
    [1.08, 0.52],
    [1.6, 0.36],
  ],
  crown: [
    [-1.7, 0.86],
    [-1.48, 0.68],
    [-1.05, 0.94],
    [-0.15, 1.06],
    [0.22, 1.05],
    [0.5, 0.76],
    [0.9, 0.6],
    [1.6, 0.4],
  ],
  roofHalf: [
    [-1.7, 0.14],
    [-1.15, 0.3],
    [-0.15, 0.48],
    [0.25, 0.44],
    [0.6, 0.28],
    [1.15, 0.22],
    [1.6, 0.04],
  ],
  glassZ: [-1.0, 0.52],
  roofZ: [-0.32, 0.16],
  pillars: [0.32, -0.82],
  grille: { half: 0.3, top: 0.42 },
};

const SURGE: Shape = {
  id: "surge",
  z0: -2.34,
  z1: 2.5,
  samples: 72,
  round: 0.72,
  enclose: 0.78,
  tireHalf: { front: 0.12, rear: 0.16 },
  halfW: [
    [-2.34, 0.9],
    [-1.9, 1.04],
    [-1.5, 1.14],
    [-0.7, 1.02],
    [0.25, 0.98],
    [1.32, 1.1],
    [1.7, 1.02],
    [2.05, 0.42],
    [2.5, 0.12],
  ],
  floor: [
    [-2.34, 0.28],
    [-1.85, 0.14],
    [2.15, 0.11],
    [2.5, 0.15],
  ],
  sill: [
    [-2.34, 0.32],
    [-1.5, 0.36],
    [0.2, 0.34],
    [1.32, 0.3],
    [2.5, 0.16],
  ],
  belt: [
    [-2.34, 0.42],
    [-1.5, 0.58],
    [-0.2, 0.6],
    [0.55, 0.55],
    [1.32, 0.5],
    [1.75, 0.6],
    [2.5, 0.22],
  ],
  crown: [
    [-2.34, 0.52],
    [-1.9, 0.66],
    [-1.45, 0.6],
    [-0.85, 0.7],
    [-0.12, 0.84],
    [0.32, 0.68],
    [0.75, 0.42],
    [1.32, 0.34],
    [2.05, 0.26],
    [2.5, 0.2],
  ],
  roofHalf: [
    [-2.34, 0.22],
    [-1.5, 0.3],
    [-0.1, 0.34],
    [0.7, 0.14],
    [1.32, 0.1],
    [2.05, 0.06],
    [2.5, 0.02],
  ],
  glassZ: [0, 0],
  roofZ: [0, 0],
  pillars: [],
  grille: { half: 0.06, top: 0.26 },
  canopy: [-0.42, 0.58],
};

const AEGIS: Shape = {
  id: "aegis",
  z0: -1.94,
  z1: 1.94,
  samples: 64,
  round: 0.18,
  enclose: 0.42,
  tireHalf: { front: 0.15, rear: 0.15 },
  halfW: [
    [-1.94, 0.88],
    [-1.55, 1.05],
    [-1.32, 1.18],
    [-0.25, 1.04],
    [0.45, 1.05],
    [1.2, 1.16],
    [1.6, 0.96],
    [1.94, 0.74],
  ],
  floor: [
    [-1.94, 0.18],
    [-1.5, 0.13],
    [1.6, 0.13],
    [1.94, 0.17],
  ],
  sill: [
    [-1.94, 0.38],
    [-1.32, 0.44],
    [0, 0.46],
    [1.2, 0.42],
    [1.94, 0.34],
  ],
  belt: [
    [-1.94, 0.48],
    [-1.32, 0.58],
    [0, 0.74],
    [1.2, 0.56],
    [1.94, 0.42],
  ],
  crown: [
    [-1.94, 0.56],
    [-1.72, 0.68],
    [-1.48, 0.74],
    [-1.22, 1.2],
    [-0.95, 1.36],
    [0.28, 1.36],
    [0.4, 1.16],
    [0.56, 0.8],
    [1.05, 0.66],
    [1.94, 0.5],
  ],
  roofHalf: [
    [-1.94, 0.2],
    [-1.35, 0.42],
    [-0.8, 0.74],
    [0.28, 0.72],
    [0.52, 0.46],
    [0.85, 0.18],
    [1.4, 0.28],
    [1.94, 0.06],
  ],
  glassZ: [-1.18, 0.62],
  roofZ: [-0.88, 0.3],
  pillars: [0.42, -0.06, -0.7],
  grille: { half: 0.5, top: 0.46 },
};

const SHAPES: Record<CarId, Shape> = { vector: VECTOR, vanta: VANTA, surge: SURGE, aegis: AEGIS };

function addArchFender(
  buckets: Record<RoleName, Bucket>,
  x: number,
  z: number,
  radius: number,
  tireHalf: number,
  outerBody: number,
): void {
  const wheelY = WHEEL_CONTACT_Y + radius;
  const shell = radius + 0.09;
  const sign = x >= 0 ? 1 : -1;
  const faceX = sign * Math.max(Math.abs(x) + tireHalf + 0.04, outerBody + 0.012);
  const segments = 18;
  const positions: number[] = [faceX, wheelY, z];
  const normals: number[] = [sign, 0, 0];
  for (let i = 0; i <= segments; i++) {
    const theta = (Math.PI * i) / segments;
    positions.push(faceX, wheelY + Math.sin(theta) * shell, z + Math.cos(theta) * shell);
    normals.push(sign, 0, 0);
  }
  const index: number[] = [];
  for (let i = 0; i < segments; i++) {
    if (sign > 0) index.push(0, i + 1, i + 2);
    else index.push(0, i + 2, i + 1);
  }
  const panel = new THREE.BufferGeometry();
  panel.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  panel.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  panel.setIndex(index);
  absorb(buckets.paint, panel);
  panel.dispose();
  const tube = new THREE.CylinderGeometry(shell * 0.98, shell * 0.98, 0.07, 24, 1, true, 0, Math.PI);
  tube.rotateZ(Math.PI / 2);
  tube.translate(faceX - sign * 0.035, wheelY, z);
  absorb(buckets.paint, tube);
  tube.dispose();
}

function addArchFenders(buckets: Record<RoleName, Bucket>, shape: Shape, layout: WheelLayout): void {
  const spots: Array<[number, number, number, number]> = [
    [layout.frontX, layout.frontZ, layout.frontRadius, shape.tireHalf.front],
    [-layout.frontX, layout.frontZ, layout.frontRadius, shape.tireHalf.front],
    [layout.rearX, layout.rearZ, layout.rearRadius, shape.tireHalf.rear],
    [-layout.rearX, layout.rearZ, layout.rearRadius, shape.tireHalf.rear],
  ];
  const outerBody = Math.max(...shape.halfW.map((pair) => pair[1]));
  for (const [x, z, radius, tireHalf] of spots) {
    addArchFender(buckets, x, z, radius, tireHalf, outerBody);
  }
}

function buildShape(shape: Shape, layout: WheelLayout, buckets: Record<RoleName, Bucket>): void {
  const rings: Array<{ z: number; loop: Pt[] }> = [];
  for (let i = 0; i < shape.samples; i++) {
    const t = i / (shape.samples - 1);
    const z = lerp(shape.z0, shape.z1, t);
    rings.push({ z, loop: halfLoop(sectionAt(shape, layout, z)) });
  }
  const noseY = curve(shape.crown, shape.z1) * 0.55 + curve(shape.floor, shape.z1) * 0.45;
  const tailY = curve(shape.crown, shape.z0) * 0.45 + curve(shape.belt, shape.z0) * 0.55;
  loftLoops((x, y, z) => buckets[roleAt(shape, x, y, z)], rings, [0, noseY], [0, tailY]);
  addArchFenders(buckets, shape, layout);
}

function skinX(shape: Shape, layout: WheelLayout, z: number, yLo: number, yHi: number): number {
  let x = 0.25;
  for (const p of sectionAt(shape, layout, z)) {
    if (p[1] >= yLo && p[1] <= yHi) x = Math.max(x, p[0]);
  }
  return x + 0.012;
}

function addSideWindow(
  buckets: Record<RoleName, Bucket>,
  x: number,
  y: number,
  z: number,
  length: number,
  height: number,
): void {
  const raw = new THREE.PlaneGeometry(length, height, 1, 1);
  raw.rotateY(x >= 0 ? Math.PI / 2 : -Math.PI / 2);
  raw.translate(x, y, z);
  absorb(buckets.glass, raw);
  raw.dispose();
}

function addShut(
  buckets: Record<RoleName, Bucket>,
  x: number,
  y: number,
  z: number,
  height: number,
): void {
  const raw = new THREE.BoxGeometry(0.016, height, 0.022);
  raw.translate(x, y, z);
  absorb(buckets.dark, raw);
  raw.dispose();
}

function dress(id: CarId, shape: Shape, layout: WheelLayout, buckets: Record<RoleName, Bucket>): void {
  const nose = shape.z1;
  const tail = shape.z0;
  const sidePair = (y: number, z: number, length: number, height: number, yLo: number, yHi: number) => {
    const x = skinX(shape, layout, z, yLo, yHi);
    addSideWindow(buckets, x, y, z, length, height);
    addSideWindow(buckets, -x, y, z, length, height);
  };
  if (id === "vector") {
    addWing(buckets, 1.5, 0.36, 0.05, 0.94, -1.92, 0.62);
    addLens(buckets, "lamp", 0.55, 0.42, nose - 0.04, 0.14, 0.04, 0.03);
    addLens(buckets, "lamp", -0.55, 0.42, nose - 0.04, 0.14, 0.04, 0.03);
    addLens(buckets, "tail", 0.58, 0.52, tail + 0.03, 0.14, 0.045, 0.025);
    addLens(buckets, "tail", -0.58, 0.52, tail + 0.03, 0.14, 0.045, 0.025);
    addMirror(buckets, 0.72, 0.82, 0.28);
    addMirror(buckets, -0.72, 0.82, 0.28);
    addPane(buckets, "glass", 0.95, 0.4, 0, 0.92, 0.52, -0.95, 0);
    sidePair(0.96, -0.12, 0.72, 0.28, 0.75, 1.12);
    addPane(buckets, "glass", 0.62, 0.26, 0, 0.98, -0.95, 0.7, 0);
    addLens(buckets, "dark", 0, 0.34, nose - 0.02, 0.26, 0.07, 0.03);
  } else if (id === "vanta") {
    addWing(buckets, 1.15, 0.28, 0.042, 0.98, -1.48, 0.74);
    addLens(buckets, "lamp", 0.48, 0.42, nose - 0.03, 0.11, 0.045, 0.025);
    addLens(buckets, "lamp", -0.48, 0.42, nose - 0.03, 0.11, 0.045, 0.025);
    addLens(buckets, "tail", 0.5, 0.55, tail + 0.03, 0.12, 0.05, 0.025);
    addLens(buckets, "tail", -0.5, 0.55, tail + 0.03, 0.12, 0.05, 0.025);
    addMirror(buckets, 0.7, 0.78, 0.22);
    addMirror(buckets, -0.7, 0.78, 0.22);
    addPane(buckets, "glass", 0.88, 0.32, 0, 0.88, 0.4, -1.05, 0);
    sidePair(0.9, -0.02, 0.55, 0.24, 0.72, 1.02);
    addPane(buckets, "glass", 0.48, 0.2, 0, 0.9, -0.78, 0.85, 0);
  } else if (id === "surge") {
    addFin(buckets, -0.05, -1.7, 0.78, 0.98);
    addWing(buckets, 1.7, 0.42, 0.06, 0.9, -2.05, 0.58);
    addLens(buckets, "lamp", 0.18, 0.28, nose - 0.02, 0.06, 0.022, 0.018);
    addLens(buckets, "lamp", -0.18, 0.28, nose - 0.02, 0.06, 0.022, 0.018);
    addLens(buckets, "tail", 0.62, 0.42, tail + 0.02, 0.1, 0.03, 0.02);
    addLens(buckets, "tail", -0.62, 0.42, tail + 0.02, 0.1, 0.03, 0.02);
    addPane(buckets, "glass", 0.62, 0.32, 0, 0.72, 0.4, -0.8, 0);
    addSideWindow(buckets, 0.4, 0.72, 0.02, 0.55, 0.22);
    addSideWindow(buckets, -0.4, 0.72, 0.02, 0.55, 0.22);
    addPane(buckets, "glass", 0.46, 0.18, 0, 0.76, -0.22, 0.6, 0);
  } else {
    addWing(buckets, 1.35, 0.3, 0.045, 0.98, -1.62, 0.7);
    addLens(buckets, "lamp", 0.58, 0.48, nose - 0.04, 0.18, 0.055, 0.03);
    addLens(buckets, "lamp", -0.58, 0.48, nose - 0.04, 0.18, 0.055, 0.03);
    addLens(buckets, "tail", 0.62, 0.62, tail + 0.03, 0.18, 0.06, 0.025);
    addLens(buckets, "tail", -0.62, 0.62, tail + 0.03, 0.18, 0.06, 0.025);
    addMirror(buckets, 0.92, 0.98, 0.42);
    addMirror(buckets, -0.92, 0.98, 0.42);
    addPane(buckets, "glass", 1.2, 0.42, 0, 1.05, 0.55, -1.15, 0);
    sidePair(1.08, 0.12, 0.38, 0.32, 0.85, 1.28);
    sidePair(1.08, -0.42, 0.42, 0.3, 0.85, 1.28);
    addPane(buckets, "glass", 0.9, 0.32, 0, 1.12, -1.12, 0.55, 0);
    for (const x of [1, -1]) {
      const shutX = x * (skinX(shape, layout, 0, 0.7, 1.2) + 0.006);
      addShut(buckets, shutX, 0.95, 0.46, 0.62);
      addShut(buckets, shutX, 0.98, -0.02, 0.7);
      addShut(buckets, shutX, 0.95, -0.72, 0.62);
      const skirt = new THREE.BoxGeometry(0.045, 0.055, 1.55);
      skirt.translate(x * 1.0, 0.24, -0.05);
      absorb(buckets.carbon, skirt);
      skirt.dispose();
    }
    addLens(buckets, "dark", 0, 0.38, nose - 0.03, 0.38, 0.08, 0.03);
  }
}

function dimsFor(shape: Shape, layout: WheelLayout): CarDims {
  const length = shape.z1 - shape.z0;
  const roofY =
    shape.id === "surge" ? 0.86 : shape.id === "vanta" ? 1.06 : shape.id === "aegis" ? 1.34 : 1.17;
  const deckY =
    shape.id === "surge" ? 0.58 : shape.id === "vanta" ? 0.7 : shape.id === "aegis" ? 0.78 : 0.68;
  return {
    halfWidth: layout.halfWidth,
    length,
    roofY,
    deckY,
    beltY: shape.id === "aegis" ? 0.74 : shape.id === "surge" ? 0.5 : 0.64,
    floorY: 0.13,
    tipZ: shape.z1,
    tailZ: shape.z0,
    frontW: layout.halfWidth * 0.92,
    rearW: layout.halfWidth * 0.96,
    frontAxleZ: layout.frontZ,
    rearAxleZ: layout.rearZ,
    lampY: shape.id === "surge" ? 0.28 : shape.id === "aegis" ? 0.5 : 0.42,
    lampZ: shape.z1 - 0.08,
    lampW: shape.id === "surge" ? 0.14 : shape.id === "aegis" ? 0.4 : 0.28,
    lampX: shape.id === "surge" ? 0.16 : layout.halfWidth * 0.5,
    tailY: shape.id === "surge" ? 0.4 : shape.id === "aegis" ? 0.58 : 0.52,
    tailZLamp: shape.z0 + 0.04,
    tailW: shape.id === "aegis" ? 0.4 : 0.28,
    mirrorY: shape.id === "surge" ? 0.62 : shape.id === "aegis" ? 0.92 : 0.76,
    mirrorZ: shape.id === "vanta" ? 0.28 : 0.4,
    mirrorX: layout.halfWidth * 0.72,
    plateY: shape.id === "surge" ? 0.42 : shape.id === "aegis" ? 0.7 : 0.55,
    numberScale: shape.id === "aegis" ? 0.92 : shape.id === "surge" ? 0.8 : 0.86,
    exhaustXs: shape.id === "vanta" ? [0] : [-0.32, 0.32],
    exhaustY: 0.3,
    glowScale: layout.halfWidth,
    contactW: layout.halfWidth * 1.6,
    contactL: length * 0.42,
    wing: {
      span: layout.halfWidth * 1.55,
      chord: 0.34,
      y: roofY,
      z: shape.z0 + 0.25,
      deckY,
      thick: 0.05,
      dual: false,
      swan: false,
      gurney: false,
    },
    fin: shape.id === "surge",
    canards: false,
    splitter: 0.28,
    skirt: 1,
    diffuserFins: 0,
    diffuserRise: 0.16,
  };
}

export function buildBody(
  id: CarId,
  layout: WheelLayout,
): { parts: Partial<Record<CarRole, THREE.BufferGeometry>>; dims: CarDims } {
  const shape = SHAPES[id];
  const buckets = emptyBuckets();
  buildShape(shape, layout, buckets);
  dress(id, shape, layout, buckets);
  return { parts: finish(buckets), dims: dimsFor(shape, layout) };
}
