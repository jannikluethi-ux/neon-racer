import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * Authored vehicle geometry.
 *
 * Every car is built from its own cross-section key table (see CAR_SPECS) so
 * the four cars read as four different machines rather than four scales of one
 * blob. The hull is lofted from those stations; the wheel arches are cut into
 * the loft by lifting the section's lower boundary over each axle, which is
 * what gives the tires a real opening to sit in.
 *
 * Purely visual: nothing in here is read by physics, AI or timing. Local axes
 * match the rest of the renderer — +Z nose, -Z tail, +X driver's left, +Y up,
 * origin on the road plane just under the tires.
 */

export type CarId = "vector" | "vanta" | "surge" | "aegis";

export type CarRole =
  | "paint"
  | "carbon"
  | "glass"
  | "dark"
  | "well"
  | "accent"
  | "lamp"
  | "tail"
  | "chrome";

export type WheelBuild = {
  /** Anchor in car-local space. y is the wheel centre height above the road. */
  x: number;
  y: number;
  z: number;
  steered: boolean;
  /** Rolling radius — the visuals match spin rate to it. */
  radius: number;
  tire: THREE.BufferGeometry;
  rim: THREE.BufferGeometry;
  disc: THREE.BufferGeometry;
  caliper: THREE.BufferGeometry;
};

export type CarDims = {
  halfWidth: number;
  length: number;
  roofY: number;
  deckY: number;
  beltY: number;
  floorY: number;
  tipZ: number;
  tailZ: number;
  frontW: number;
  rearW: number;
  frontAxleZ: number;
  rearAxleZ: number;
  lampY: number;
  lampZ: number;
  lampW: number;
  lampX: number;
  tailY: number;
  tailZLamp: number;
  tailW: number;
  mirrorY: number;
  mirrorZ: number;
  mirrorX: number;
  plateY: number;
  numberScale: number;
  exhaustXs: number[];
  exhaustY: number;
  glowScale: number;
  contactW: number;
  contactL: number;
  wing: { span: number; chord: number; y: number; z: number; deckY: number; thick: number; dual: boolean; swan: boolean; gurney: boolean };
  fin: boolean;
  canards: boolean;
  splitter: number;
  skirt: number;
  diffuserFins: number;
  diffuserRise: number;
};

export type CarGeometry = {
  parts: Partial<Record<CarRole, THREE.BufferGeometry>>;
  wheels: WheelBuild[];
  dims: CarDims;
};

type Zone =
  | "tail"
  | "deck"
  | "glassR"
  | "pillarC"
  | "roof"
  | "pillarA"
  | "glassF"
  | "hood"
  | "nose";

type Key = {
  z: number;
  /** Centreline top height: hood, roof or deck depending on zone. */
  y: number;
  /** Half width at the belt/fender line — the widest point of the station. */
  w: number;
  /** Half width of the flat top (roof panel / hood centre). */
  cab: number;
  /** Height of the widest point (belt line, fender crown or bumper edge). */
  fY: number;
  zone: Zone;
};

type RimStyle = {
  spokes: number;
  spokeW: number;
  spokeT: number;
  face: number;
  barrel: number;
  discR: number;
  caliper: number;
  lipSteps: number;
};

type TireSpec = { r: number; half: number; rimR: number; grooves: number };

type CarSpec = {
  id: CarId;
  keys: Key[];
  frontAxleZ: number;
  rearAxleZ: number;
  archHalf: number;
  archClear: number;
  floor: number;
  tireFront: TireSpec;
  tireRear: TireSpec;
  rim: RimStyle;
  wheelbase: number;
};

const CONTACT = 0.032;
const RING_COUNT = 52;
const PROFILE_LOW = 10;
const PROFILE_UP = 9;
const K = PROFILE_LOW + PROFILE_UP;
const LOOP_N = K * 2 - 2;
/** Upper-profile samples below this are window glass in a greenhouse zone. */
const GLASS_LOW = 0.08;
const GLASS_HIGH = 0.62;

function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** Closest authored station to z, used for zone lookups. */
function zoneAt(keys: Key[], z: number): Zone {
  let best = keys[0]!;
  let bestD = Infinity;
  for (const k of keys) {
    const d = Math.abs(k.z - z);
    if (d < bestD) {
      best = k;
      bestD = d;
    }
  }
  return best.zone;
}

function catmullField(keys: Key[], z: number, field: "y" | "w" | "cab" | "fY"): number {
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1]!.z < z) i++;
  const i0 = Math.max(0, i - 1);
  const i1 = i;
  const i2 = Math.min(keys.length - 1, i + 1);
  const i3 = Math.min(keys.length - 1, i + 2);
  const z1 = keys[i1]!.z;
  const z2 = keys[i2]!.z;
  const t = z2 === z1 ? 0 : clamp((z - z1) / (z2 - z1), 0, 1);
  const p0 = keys[i0]![field];
  const p1 = keys[i1]![field];
  const p2 = keys[i2]![field];
  const p3 = keys[i3]![field];
  const tt = t * t;
  const ttt = tt * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * tt + (-p0 + 3 * p1 - 3 * p2 + p3) * ttt);
}

type Pt = [number, number];
type Hint = CarRole | "side";

type Ring = {
  z: number;
  y: number;
  w: number;
  cab: number;
  fY: number;
  floor: number;
  ceil: number;
  zone: Zone;
  loop: Pt[];
  hints: Hint[];
};

/** Arch ceiling height: tire top plus clearance for suspension travel. */
function archTop(spec: CarSpec): number {
  return CONTACT + spec.tireFront.r * 2 + spec.archClear;
}

/** Sides tuck in below the belt line, then flare out to the widest point. */
function sideShape(xn: number, floor: number, fY: number): number {
  if (xn <= 0.7) return floor;
  const t = smoothstep((xn - 0.7) / 0.3);
  return floor + (fY - floor) * Math.pow(t, 1.15);
}

/**
 * Cross-section for one station. The lower boundary is the wide floor pan with
 * a rocker/sill that rises to the belt line; over the axles it is lifted to
 * the arch ceiling, which carves the wheel opening out of the loft.
 */
function profileAt(
  w: number,
  crown: number,
  fY: number,
  cab: number,
  floor: number,
  ceil: number,
): { loop: Pt[]; hints: Hint[] } {
  const roofHalf = clamp(cab, 0.02, w * 0.92);
  const xn = [0, 0.3, 0.47, 0.505, 0.6, 0.7, 0.78, 0.86, 0.94, 1];
  const lower: Pt[] = [];
  const lowerHints: Hint[] = [];
  const arching = ceil > floor + 0.05;
  for (let i = 0; i < xn.length; i++) {
    const x = xn[i]!;
    const shape = sideShape(x, floor, fY);
    let y = shape;
    let hint: Hint = y < 0.34 ? "carbon" : "paint";
    // Points outboard of the inner well wall are lifted to the arch ceiling —
    // but only where the ceiling actually does the lifting. A point whose own
    // side shape already clears it is fender skin, not liner.
    if (arching && i >= 3 && ceil > shape + 0.002) {
      y = ceil;
      hint = "well";
    }
    lower.push([x * w, y]);
    lowerHints.push(hint);
  }
  const upper: Pt[] = [];
  const upperHints: Hint[] = [];
  for (let j = 0; j < PROFILE_UP; j++) {
    const t = j / (PROFILE_UP - 1);
    let x: number;
    let y: number;
    if (t <= 0.75) {
      const s = t / 0.75;
      x = roofHalf + (w - roofHalf) * Math.pow(1 - s, 0.6);
      y = fY + (crown - fY) * Math.pow(s, 0.62);
    } else {
      const s = (t - 0.75) / 0.25;
      x = roofHalf * (1 - Math.pow(s, 1.8));
      y = crown + 0.012 * Math.sin(s * Math.PI);
    }
    upper.push([x, y]);
    upperHints.push(y < 0.34 ? "carbon" : "paint");
  }
  const loop: Pt[] = [...lower, ...upper];
  const hints: Hint[] = [...lowerHints, ...upperHints];
  for (let i = loop.length - 2; i >= 1; i--) {
    loop.push([-loop[i]![0], loop[i]![1]]);
    hints.push(hints[i]!);
  }
  return { loop, hints };
}

function sampleHull(spec: CarSpec): Ring[] {
  const keys = spec.keys;
  const z0 = keys[0]!.z;
  const z1 = keys[keys.length - 1]!.z;
  const ceil = archTop(spec);
  const rings: Ring[] = [];
  for (let i = 0; i < RING_COUNT; i++) {
    const z = z0 + ((z1 - z0) * i) / (RING_COUNT - 1);
    const w = clamp(catmullField(keys, z, "w"), 0.1, 1.5);
    const crown = clamp(catmullField(keys, z, "y"), 0.3, 1.5);
    const cab = clamp(catmullField(keys, z, "cab"), 0.02, 0.8);
    const fY = clamp(catmullField(keys, z, "fY"), 0.3, 1.5);
    // Wheel-opening ceiling: smooth bump centred on each axle.
    let lift = 0;
    for (const axle of [spec.frontAxleZ, spec.rearAxleZ]) {
      const t = 1 - Math.abs(z - axle) / spec.archHalf;
      if (t > 0) lift = Math.max(lift, smoothstep(t));
    }
    const archY = spec.floor + (ceil - spec.floor) * lift;
    const zone = zoneAt(keys, z);
    const section = profileAt(w, crown, fY, cab, spec.floor, archY);
    rings.push({
      z,
      y: crown,
      w,
      cab,
      fY,
      floor: spec.floor,
      ceil: archY,
      zone,
      loop: section.loop,
      hints: section.hints,
    });
  }
  return rings;
}

/** Lofted shell split into material buckets by zone, height and arch region. */
function buildHull(rings: Ring[]): Partial<Record<CarRole, THREE.BufferGeometry>> {
  const n = LOOP_N;
  const positions: number[] = [];
  const indices: number[] = [];
  for (const ring of rings) {
    for (const p of ring.loop) positions.push(p[0], p[1], ring.z);
  }
  const seg = rings.length - 1;
  const quads: Array<{ a: number; b: number; c: number; d: number; zone: Zone; p: number; y: number; ceil: number; floor: number; hint: Hint }> = [];
  for (let s = 0; s < seg; s++) {
    const r0 = rings[s]!;
    const r1 = rings[s + 1]!;
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n;
      const a = s * n + i;
      const b = s * n + i2;
      const c = (s + 1) * n + i;
      const d = (s + 1) * n + i2;
      const zone = r0.zone === r1.zone ? r0.zone : r0.zone === "pillarA" || r1.zone === "pillarA" ? "pillarA" : r0.zone === "pillarC" || r1.zone === "pillarC" ? "pillarC" : r0.zone;
      const p = i < K ? i : LOOP_N - i;
      const y = (r0.loop[i]![1] + r0.loop[i2]![1]) * 0.5;
      const ceil = (r0.ceil + r1.ceil) * 0.5;
      const floor = (r0.floor + r1.floor) * 0.5;
      quads.push({ a, b, c, d, zone, p, y, ceil, floor, hint: r0.hints[i]! });
      indices.push(a, b, d, a, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const buckets: Record<CarRole, number[]> = {
    paint: [],
    carbon: [],
    glass: [],
    dark: [],
    well: [],
    accent: [],
    lamp: [],
    tail: [],
    chrome: [],
  };
  const push = (role: CarRole, q: { a: number; b: number; c: number; d: number }) => {
    buckets[role].push(q.a, q.b, q.d, q.a, q.d, q.c);
  };
  for (const q of quads) {
    const upper = q.p >= PROFILE_LOW;
    const t = upper ? (q.p - PROFILE_LOW) / (PROFILE_UP - 1) : -1;
    let role: CarRole = "paint";
    if (!upper) {
      role = q.hint === "well" ? "well" : q.y < 0.34 ? "carbon" : "paint";
    } else if (q.zone === "pillarA" || q.zone === "pillarC") {
      // Pillars only interrupt the greenhouse band; below the belt line the
      // station stays body colour so the stripe is a pillar, not a decal.
      role = t <= 0.75 ? "dark" : "paint";
    } else if (q.zone === "glassF" || q.zone === "glassR") {
      role = t >= 0.5 ? "glass" : "paint";
    } else if (q.zone === "roof") {
      role = t > GLASS_LOW && t < GLASS_HIGH ? "glass" : "paint";
    }
    push(role, q);
  }

  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const nrm = geo.getAttribute("normal") as THREE.BufferAttribute;
  const take = (ids: number[]): THREE.BufferGeometry => {
    if (ids.length < 3) return new THREE.BufferGeometry();
    const arr = new Float32Array(ids.length * 3);
    const na = new Float32Array(ids.length * 3);
    for (let i = 0; i < ids.length; i++) {
      const v = ids[i]!;
      arr[i * 3] = pos.getX(v);
      arr[i * 3 + 1] = pos.getY(v);
      arr[i * 3 + 2] = pos.getZ(v);
      na[i * 3] = nrm.getX(v);
      na[i * 3 + 1] = nrm.getY(v);
      na[i * 3 + 2] = nrm.getZ(v);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(na, 3));
    return g;
  };
  const out: Partial<Record<CarRole, THREE.BufferGeometry>> = {};
  for (const role of Object.keys(buckets) as CarRole[]) {
    const g = take(buckets[role]);
    if (g.getAttribute("position")) out[role] = g;
  }
  geo.dispose();
  return out;
}

// ---------------------------------------------------------------------------
// Detail geometry
// ---------------------------------------------------------------------------

function box(w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.deleteAttribute("uv");
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

/** Planar UVs so carbon parts can carry a weave map without a UV unwrap. */
export function boxUV(geo: THREE.BufferGeometry, scale: number): void {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const nrm = geo.getAttribute("normal") as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nrm.getX(i));
    const ny = Math.abs(nrm.getY(i));
    const nz = Math.abs(nrm.getZ(i));
    let u: number;
    let v: number;
    if (ny >= nx && ny >= nz) {
      u = pos.getX(i);
      v = pos.getZ(i);
    } else if (nx >= nz) {
      u = pos.getZ(i);
      v = pos.getY(i);
    } else {
      u = pos.getX(i);
      v = pos.getY(i);
    }
    uv[i * 2] = u * scale;
    uv[i * 2 + 1] = v * scale;
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

function wingPlane(span: number, chord: number, thick: number): THREE.BufferGeometry {
  const profile: Array<[number, number]> = [
    [0.015, thick * 0.15],
    [chord * 0.18, thick * 0.72],
    [chord * 0.55, thick],
    [chord * 0.88, thick * 0.28],
    [chord, 0.002],
    [chord * 0.62, -thick * 0.18],
    [chord * 0.16, -thick * 0.04],
  ];
  const n = profile.length;
  const positions: number[] = [];
  for (const x of [-span / 2, span / 2]) {
    for (const [z, y] of profile) positions.push(x, y - thick * 0.35, z - chord * 0.62);
  }
  const indices: number[] = [];
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    indices.push(i, n + i2, i2, i, n + i, n + i2);
  }
  for (let i = 1; i < n - 1; i++) {
    indices.push(0, i + 1, i);
    indices.push(n, n + i, n + i + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------------------
// Wheels
// ---------------------------------------------------------------------------

/**
 * Tire carcass: bulged sidewalls, a rounded shoulder and real circumferential
 * grooves cut into the tread radius so the tire reads as rubber, not a disc.
 */
function tireGeometry(spec: TireSpec): THREE.BufferGeometry {
  const r = spec.r;
  const hw = spec.half;
  const rimR = spec.rimR;
  const pts: THREE.Vector2[] = [];
  const grooveDepth = 0.014;
  const crown = r;
  // Bead -> sidewall bulge -> shoulder -> tread with grooves -> mirrored.
  pts.push(new THREE.Vector2(rimR + 0.006, -hw * 0.86));
  pts.push(new THREE.Vector2(rimR + 0.02, -hw * 0.94));
  pts.push(new THREE.Vector2(r * 0.72, -hw * 1.0));
  pts.push(new THREE.Vector2(r * 0.86, -hw * 0.96));
  pts.push(new THREE.Vector2(r * 0.945, -hw * 0.86));
  pts.push(new THREE.Vector2(r * 0.985, -hw * 0.7));
  const treadStart = -hw * 0.66;
  const treadEnd = hw * 0.66;
  const bands = spec.grooves;
  pts.push(new THREE.Vector2(crown, treadStart));
  for (let i = 1; i <= bands; i++) {
    const f = i / (bands + 1);
    const y = treadStart + (treadEnd - treadStart) * f;
    const g = 0.055;
    pts.push(new THREE.Vector2(crown - grooveDepth, y - g * hw));
    pts.push(new THREE.Vector2(crown - grooveDepth, y + g * hw));
  }
  pts.push(new THREE.Vector2(crown, treadEnd));
  pts.push(new THREE.Vector2(r * 0.985, hw * 0.7));
  pts.push(new THREE.Vector2(r * 0.945, hw * 0.86));
  pts.push(new THREE.Vector2(r * 0.86, hw * 0.96));
  pts.push(new THREE.Vector2(r * 0.72, hw * 1.0));
  pts.push(new THREE.Vector2(rimR + 0.02, hw * 0.94));
  pts.push(new THREE.Vector2(rimR + 0.006, hw * 0.86));
  const g = new THREE.LatheGeometry(pts, 34);
  g.rotateZ(Math.PI / 2);
  return g;
}

/**
 * Rim: outer lip, dished spokes, hub, lugs and a barrel that runs inboard, so
 * the wheel still reads as a wheel from directly behind the car. `side` is +1
 * for the outboard face on the car's left, -1 on the right, because a wheel
 * face always points away from the car.
 */
function rimGeometry(style: RimStyle, tire: TireSpec, side: 1 | -1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const take = (g: THREE.BufferGeometry) => {
    const flatG = g.toNonIndexed();
    g.dispose();
    flatG.deleteAttribute("uv");
    parts.push(flatG);
  };
  const rimR = tire.rimR;
  const hw = tire.half;
  const faceX = side * hw * 0.78;
  const behind = (v: number) => faceX - side * v;
  // Outer lip: a stepped ring just outboard of the tire bead.
  const lip = new THREE.TorusGeometry(rimR, 0.016, 7, 30);
  lip.rotateY(Math.PI / 2);
  lip.translate(faceX + side * 0.01, 0, 0);
  take(lip);
  // Outer face ring: an annulus, never a capped disc — the spokes, hub and
  // brake have to stay visible through the open centre.
  const face = new THREE.RingGeometry(rimR - 0.052, rimR - 0.004, 30);
  face.rotateY((side * Math.PI) / 2);
  face.translate(faceX - side * 0.012, 0, 0);
  take(face);
  const barrelLip = new THREE.CylinderGeometry(rimR - 0.016, rimR - 0.05, 0.04, 26, 1, true);
  barrelLip.rotateZ(Math.PI / 2);
  barrelLip.translate(behind(0.03), 0, 0);
  take(barrelLip);
  // Barrel runs inboard behind the face so the wheel reads from behind too.
  const barrelLen = Math.max(0.1, hw * 1.5);
  const barrel = new THREE.CylinderGeometry(rimR - 0.032, rimR - 0.045, barrelLen, 24, 1, true);
  barrel.rotateZ(Math.PI / 2);
  barrel.translate(behind(0.04 + barrelLen * 0.5), 0, 0);
  take(barrel);
  // Spokes fan from the hub to the lip in the wheel's face plane.
  const hubR = 0.064;
  const dishX = behind(0.035);
  for (let i = 0; i < style.spokes; i++) {
    const ang = (i * Math.PI * 2) / style.spokes;
    const len = rimR - hubR * 0.55;
    const spoke = new THREE.BoxGeometry(style.spokeT, len, style.spokeW);
    spoke.translate(0, hubR * 0.5 + len * 0.5 - 0.012, 0);
    spoke.rotateX(ang);
    spoke.translate(dishX, 0, 0);
    take(spoke);
    const root = new THREE.BoxGeometry(style.spokeT * 1.3, hubR * 1.05, style.spokeW * 1.15);
    root.translate(0, hubR * 0.8, 0);
    root.rotateX(ang);
    root.translate(dishX, 0, 0);
    take(root);
  }
  // Hub face, centre cap and lug nuts.
  const hub = new THREE.CylinderGeometry(hubR, hubR * 0.92, 0.05, 20);
  hub.rotateZ(Math.PI / 2);
  hub.translate(behind(0.03), 0, 0);
  take(hub);
  const cap = new THREE.CylinderGeometry(hubR * 0.58, hubR * 0.62, 0.03, 16);
  cap.rotateZ(Math.PI / 2);
  cap.translate(faceX - side * 0.014, 0, 0);
  take(cap);
  for (let i = 0; i < 5; i++) {
    const ang = (i * Math.PI * 2) / 5 + 0.4;
    const lug = new THREE.CylinderGeometry(0.014, 0.014, 0.024, 6);
    lug.rotateZ(Math.PI / 2);
    lug.translate(faceX - side * 0.012, Math.cos(ang) * hubR * 0.74, Math.sin(ang) * hubR * 0.74);
    take(lug);
  }
  // Inner barrel wall closes the wheel off on the inboard side.
  const back = new THREE.CylinderGeometry(rimR - 0.045, rimR - 0.045, 0.02, 22);
  back.rotateZ(Math.PI / 2);
  back.translate(behind(0.04 + barrelLen), 0, 0);
  take(back);
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error("rim merge failed");
  return merged;
}

function discGeometry(style: RimStyle): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(style.discR, style.discR, 0.024, 26);
  g.rotateZ(Math.PI / 2);
  const non = g.toNonIndexed();
  g.dispose();
  const hat = new THREE.CylinderGeometry(style.discR * 0.52, style.discR * 0.52, 0.03, 18);
  hat.rotateZ(Math.PI / 2);
  hat.translate(-0.018, 0, 0);
  const hatNon = hat.toNonIndexed();
  hat.dispose();
  const merged = mergeGeometries([non, hatNon], false);
  non.dispose();
  hatNon.dispose();
  if (!merged) throw new Error("disc merge failed");
  return merged;
}

function caliperGeometry(style: RimStyle): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(0.056, style.discR * 0.78, 0.1);
  body.translate(0, style.discR * 0.6, 0);
  const bridge = new THREE.BoxGeometry(0.078, 0.05, 0.13);
  bridge.translate(0.004, style.discR * 0.94, 0);
  const piston = new THREE.CylinderGeometry(0.03, 0.03, 0.06, 10);
  piston.rotateZ(Math.PI / 2);
  piston.translate(0.03, style.discR * 0.5, 0.03);
  const a = body.toNonIndexed();
  const b = bridge.toNonIndexed();
  const c = piston.toNonIndexed();
  body.dispose();
  bridge.dispose();
  piston.dispose();
  a.deleteAttribute("uv");
  b.deleteAttribute("uv");
  c.deleteAttribute("uv");
  const merged = mergeGeometries([a, b, c], false);
  a.dispose();
  b.dispose();
  c.dispose();
  if (!merged) throw new Error("caliper merge failed");
  // Sit the caliper ahead of the top of the disc, where a real upright mounts it.
  merged.rotateX(0.75);
  return merged;
}

// ---------------------------------------------------------------------------
// The four cars
// ---------------------------------------------------------------------------

/**
 * Each car is authored as its own station table. Dimensions are real: wheel
 * bases between 2.4 and 2.95 m, body widths 1.85 to 2.24 m, floors around
 * 0.14 m above the asphalt so the cars sit on the road instead of hovering.
 */
const SPECS: Record<CarId, CarSpec> = {
  // Balanced GT3 coupe — long bonnet, cabin set back, full-width tail.
  vector: {
    id: "vector",
    frontAxleZ: 1.15,
    rearAxleZ: -1.35,
    archHalf: 0.62,
    archClear: 0.075,
    floor: 0.145,
    wheelbase: 2.5,
    tireFront: { r: 0.345, half: 0.13, rimR: 0.245, grooves: 3 },
    tireRear: { r: 0.345, half: 0.15, rimR: 0.245, grooves: 3 },
    rim: { spokes: 7, spokeW: 0.052, spokeT: 0.036, face: 0xdde5ec, barrel: 0xc3ccd4, discR: 0.2, caliper: 0x2ee6ff, lipSteps: 2 },
    keys: [
      { z: -2.12, y: 0.74, w: 0.88, cab: 0.08, fY: 0.78, zone: "tail" },
      { z: -1.98, y: 0.84, w: 0.98, cab: 0.12, fY: 0.88, zone: "tail" },
      { z: -1.78, y: 0.9, w: 1.04, cab: 0.16, fY: 0.92, zone: "deck" },
      { z: -1.55, y: 0.93, w: 1.07, cab: 0.22, fY: 0.95, zone: "deck" },
      { z: -1.35, y: 0.94, w: 1.07, cab: 0.3, fY: 0.95, zone: "deck" },
      { z: -1.1, y: 0.99, w: 1.02, cab: 0.38, fY: 0.93, zone: "glassR" },
      { z: -0.85, y: 1.07, w: 0.96, cab: 0.48, fY: 0.91, zone: "glassR" },
      { z: -0.58, y: 1.14, w: 0.9, cab: 0.55, fY: 0.9, zone: "pillarC" },
      { z: -0.4, y: 1.16, w: 0.88, cab: 0.58, fY: 0.89, zone: "roof" },
      { z: -0.1, y: 1.17, w: 0.88, cab: 0.59, fY: 0.89, zone: "roof" },
      { z: 0.14, y: 1.15, w: 0.9, cab: 0.57, fY: 0.89, zone: "roof" },
      { z: 0.3, y: 1.1, w: 0.92, cab: 0.52, fY: 0.9, zone: "pillarA" },
      { z: 0.48, y: 1.02, w: 0.94, cab: 0.44, fY: 0.9, zone: "glassF" },
      { z: 0.7, y: 0.93, w: 0.95, cab: 0.32, fY: 0.9, zone: "glassF" },
      { z: 0.9, y: 0.86, w: 0.97, cab: 0.16, fY: 0.9, zone: "hood" },
      { z: 1.15, y: 0.83, w: 1.01, cab: 0.07, fY: 0.89, zone: "hood" },
      { z: 1.45, y: 0.79, w: 1.0, cab: 0.05, fY: 0.85, zone: "hood" },
      { z: 1.78, y: 0.72, w: 0.95, cab: 0.04, fY: 0.76, zone: "nose" },
      { z: 2.02, y: 0.65, w: 0.86, cab: 0.03, fY: 0.68, zone: "nose" },
      { z: 2.16, y: 0.58, w: 0.72, cab: 0.03, fY: 0.6, zone: "nose" },
    ],
  },

  // Short-wheelbase GT4 — upright cabin, tall rear wing, stubby overhangs.
  vanta: {
    id: "vanta",
    frontAxleZ: 1.08,
    rearAxleZ: -1.3,
    archHalf: 0.56,
    archClear: 0.07,
    floor: 0.15,
    wheelbase: 2.38,
    tireFront: { r: 0.335, half: 0.125, rimR: 0.238, grooves: 2 },
    tireRear: { r: 0.335, half: 0.155, rimR: 0.238, grooves: 2 },
    rim: { spokes: 5, spokeW: 0.09, spokeT: 0.05, face: 0x9aa4ae, barrel: 0x8f99a3, discR: 0.192, caliper: 0xff4d24, lipSteps: 2 },
    keys: [
      { z: -1.96, y: 0.78, w: 0.86, cab: 0.1, fY: 0.8, zone: "tail" },
      { z: -1.84, y: 0.86, w: 0.98, cab: 0.14, fY: 0.88, zone: "tail" },
      { z: -1.66, y: 0.9, w: 1.06, cab: 0.18, fY: 0.92, zone: "deck" },
      { z: -1.45, y: 0.92, w: 1.11, cab: 0.24, fY: 0.94, zone: "deck" },
      { z: -1.3, y: 0.93, w: 1.12, cab: 0.3, fY: 0.94, zone: "deck" },
      { z: -1.06, y: 1.0, w: 1.06, cab: 0.4, fY: 0.93, zone: "glassR" },
      { z: -0.8, y: 1.09, w: 1.0, cab: 0.5, fY: 0.92, zone: "glassR" },
      { z: -0.52, y: 1.13, w: 0.94, cab: 0.56, fY: 0.91, zone: "pillarC" },
      { z: -0.34, y: 1.15, w: 0.92, cab: 0.6, fY: 0.9, zone: "roof" },
      { z: -0.02, y: 1.16, w: 0.92, cab: 0.6, fY: 0.9, zone: "roof" },
      { z: 0.2, y: 1.14, w: 0.94, cab: 0.58, fY: 0.9, zone: "roof" },
      { z: 0.34, y: 1.09, w: 0.96, cab: 0.52, fY: 0.91, zone: "pillarA" },
      { z: 0.5, y: 1.0, w: 0.97, cab: 0.44, fY: 0.92, zone: "glassF" },
      { z: 0.7, y: 0.9, w: 0.98, cab: 0.3, fY: 0.92, zone: "glassF" },
      { z: 0.88, y: 0.84, w: 1.0, cab: 0.14, fY: 0.92, zone: "hood" },
      { z: 1.08, y: 0.8, w: 1.04, cab: 0.07, fY: 0.9, zone: "hood" },
      { z: 1.34, y: 0.76, w: 1.02, cab: 0.05, fY: 0.84, zone: "hood" },
      { z: 1.62, y: 0.7, w: 0.96, cab: 0.04, fY: 0.74, zone: "nose" },
      { z: 1.84, y: 0.64, w: 0.86, cab: 0.03, fY: 0.66, zone: "nose" },
      { z: 1.96, y: 0.58, w: 0.7, cab: 0.03, fY: 0.6, zone: "nose" },
    ],
  },

  // Long-tail prototype — low bubble cockpit, shark fin, long diffuser.
  surge: {
    id: "surge",
    frontAxleZ: 1.32,
    rearAxleZ: -1.5,
    archHalf: 0.66,
    archClear: 0.07,
    floor: 0.14,
    wheelbase: 2.82,
    tireFront: { r: 0.34, half: 0.12, rimR: 0.242, grooves: 3 },
    tireRear: { r: 0.34, half: 0.16, rimR: 0.242, grooves: 3 },
    rim: { spokes: 10, spokeW: 0.03, spokeT: 0.024, face: 0xe8eef4, barrel: 0xb9c2ca, discR: 0.205, caliper: 0xffe14a, lipSteps: 3 },
    keys: [
      { z: -2.4, y: 0.7, w: 0.86, cab: 0.1, fY: 0.74, zone: "tail" },
      { z: -2.24, y: 0.8, w: 0.98, cab: 0.14, fY: 0.84, zone: "tail" },
      { z: -2.0, y: 0.86, w: 1.06, cab: 0.2, fY: 0.9, zone: "deck" },
      { z: -1.72, y: 0.9, w: 1.1, cab: 0.26, fY: 0.93, zone: "deck" },
      { z: -1.5, y: 0.91, w: 1.1, cab: 0.32, fY: 0.94, zone: "deck" },
      { z: -1.2, y: 0.94, w: 1.06, cab: 0.42, fY: 0.93, zone: "glassR" },
      { z: -0.9, y: 1.0, w: 1.0, cab: 0.5, fY: 0.9, zone: "glassR" },
      { z: -0.6, y: 1.04, w: 0.94, cab: 0.54, fY: 0.88, zone: "pillarC" },
      { z: -0.4, y: 1.05, w: 0.9, cab: 0.56, fY: 0.87, zone: "roof" },
      { z: -0.08, y: 1.06, w: 0.9, cab: 0.56, fY: 0.87, zone: "roof" },
      { z: 0.18, y: 1.04, w: 0.92, cab: 0.54, fY: 0.87, zone: "roof" },
      { z: 0.34, y: 1.0, w: 0.94, cab: 0.5, fY: 0.88, zone: "pillarA" },
      { z: 0.54, y: 0.94, w: 0.96, cab: 0.42, fY: 0.88, zone: "glassF" },
      { z: 0.78, y: 0.86, w: 0.98, cab: 0.3, fY: 0.88, zone: "glassF" },
      { z: 1.0, y: 0.8, w: 1.0, cab: 0.14, fY: 0.88, zone: "hood" },
      { z: 1.32, y: 0.76, w: 1.03, cab: 0.07, fY: 0.88, zone: "hood" },
      { z: 1.66, y: 0.72, w: 1.02, cab: 0.05, fY: 0.83, zone: "hood" },
      { z: 2.0, y: 0.66, w: 0.96, cab: 0.04, fY: 0.74, zone: "nose" },
      { z: 2.28, y: 0.6, w: 0.84, cab: 0.03, fY: 0.66, zone: "nose" },
      { z: 2.44, y: 0.54, w: 0.64, cab: 0.03, fY: 0.58, zone: "nose" },
    ],
  },

  // Wide touring car — boxy, flat roof, big arches and a swan-neck wing.
  aegis: {
    id: "aegis",
    frontAxleZ: 1.2,
    rearAxleZ: -1.32,
    archHalf: 0.6,
    archClear: 0.08,
    floor: 0.15,
    wheelbase: 2.52,
    tireFront: { r: 0.35, half: 0.15, rimR: 0.25, grooves: 4 },
    tireRear: { r: 0.35, half: 0.15, rimR: 0.25, grooves: 4 },
    rim: { spokes: 6, spokeW: 0.07, spokeT: 0.045, face: 0xc8a06a, barrel: 0xb08c58, discR: 0.215, caliper: 0x9fd4ff, lipSteps: 2 },
    keys: [
      { z: -2.14, y: 0.8, w: 0.96, cab: 0.1, fY: 0.84, zone: "tail" },
      { z: -2.0, y: 0.88, w: 1.06, cab: 0.14, fY: 0.9, zone: "tail" },
      { z: -1.8, y: 0.92, w: 1.14, cab: 0.18, fY: 0.94, zone: "deck" },
      { z: -1.56, y: 0.95, w: 1.18, cab: 0.24, fY: 0.96, zone: "deck" },
      { z: -1.32, y: 0.96, w: 1.18, cab: 0.32, fY: 0.96, zone: "deck" },
      { z: -1.05, y: 1.05, w: 1.14, cab: 0.42, fY: 0.95, zone: "glassR" },
      { z: -0.8, y: 1.12, w: 1.1, cab: 0.5, fY: 0.94, zone: "glassR" },
      { z: -0.54, y: 1.18, w: 1.04, cab: 0.56, fY: 0.93, zone: "pillarC" },
      { z: -0.36, y: 1.21, w: 1.02, cab: 0.6, fY: 0.93, zone: "roof" },
      { z: -0.04, y: 1.22, w: 1.02, cab: 0.6, fY: 0.93, zone: "roof" },
      { z: 0.2, y: 1.2, w: 1.04, cab: 0.58, fY: 0.93, zone: "roof" },
      { z: 0.34, y: 1.14, w: 1.06, cab: 0.54, fY: 0.94, zone: "pillarA" },
      { z: 0.52, y: 1.06, w: 1.08, cab: 0.46, fY: 0.94, zone: "glassF" },
      { z: 0.74, y: 0.95, w: 1.09, cab: 0.34, fY: 0.94, zone: "glassF" },
      { z: 0.94, y: 0.86, w: 1.1, cab: 0.16, fY: 0.94, zone: "hood" },
      { z: 1.2, y: 0.83, w: 1.13, cab: 0.08, fY: 0.93, zone: "hood" },
      { z: 1.5, y: 0.8, w: 1.12, cab: 0.05, fY: 0.9, zone: "hood" },
      { z: 1.82, y: 0.74, w: 1.06, cab: 0.04, fY: 0.8, zone: "nose" },
      { z: 2.06, y: 0.68, w: 0.98, cab: 0.03, fY: 0.72, zone: "nose" },
      { z: 2.2, y: 0.6, w: 0.8, cab: 0.03, fY: 0.64, zone: "nose" },
    ],
  },
};

export function carSpec(id: string): CarSpec {
  return SPECS[id as CarId] ?? SPECS.vector;
}

export function isCarId(id: string): id is CarId {
  return id in SPECS;
}

function stationAt(spec: CarSpec, z: number, field: "y" | "w" | "cab" | "fY"): number {
  return catmullField(spec.keys, z, field);
}

function detailGeometry(spec: CarSpec, dims: CarDims): Partial<Record<CarRole, THREE.BufferGeometry>> {
  const buckets: Record<CarRole, THREE.BufferGeometry[]> = {
    paint: [],
    carbon: [],
    glass: [],
    dark: [],
    well: [],
    accent: [],
    lamp: [],
    tail: [],
    chrome: [],
  };
  const add = (role: CarRole, g: THREE.BufferGeometry) => buckets[role].push(g);
  const fz = spec.frontAxleZ;
  const rz = spec.rearAxleZ;
  const half = dims.halfWidth;

  // Front splitter: a carbon blade tied into the floor so it never floats.
  const noseW = stationAt(spec, dims.tipZ - 0.16, "w");
  add("carbon", box(noseW * 1.86, 0.03, dims.splitter, 0, spec.floor - 0.004, dims.tipZ - dims.splitter * 0.42));
  add("carbon", box(noseW * 1.5, 0.05, 0.12, 0, spec.floor + 0.01, dims.tipZ - 0.03));
  for (const side of [-1, 1]) {
    // Side skirts sit proud of the sill between the axles.
    const skirtLen = Math.abs(fz - rz) * 0.86;
    add(
      "carbon",
      box(0.07, 0.05, skirtLen, side * (half * 0.94), spec.floor - 0.01, (fz + rz) * 0.5,
        0, 0, side * 0.05),
    );
    if (dims.canards) {
      add("carbon", box(0.24, 0.02, 0.14, side * (noseW * 1.02), spec.floor + 0.2, dims.tipZ - 0.34, 0, 0, side * 0.18));
      add("carbon", box(0.2, 0.02, 0.12, side * (noseW * 1.0), spec.floor + 0.1, dims.tipZ - 0.3, 0, 0, side * 0.2));
    }
    // Rocker transition into the rear arch.
    add("carbon", box(0.05, 0.06, 0.3, side * (half * 0.9), spec.floor + 0.03, rz + 0.34));
  }

  // Rear diffuser: rakes up towards the tail with vertical strakes.
  const diffW = dims.rearW * 1.86;
  add("carbon", box(diffW, 0.03, 0.54, 0, spec.floor + 0.02, dims.tailZ + 0.2, dims.diffuserRise));
  for (let i = 0; i < dims.diffuserFins; i++) {
    const t = dims.diffuserFins === 1 ? 0 : (i / (dims.diffuserFins - 1)) * 2 - 1;
    add("carbon", box(0.022, 0.075, 0.46, t * diffW * 0.38, spec.floor + 0.035, dims.tailZ + 0.2, dims.diffuserRise));
  }

  // Rear wing: main plane, flap, endplates, pylons (and swan-neck stanchions).
  const wingSpan = dims.wing.span;
  const wing = wingPlane(wingSpan, dims.wing.chord, dims.wing.thick);
  add("carbon", wing.translate(0, dims.wing.y, dims.wing.z));
  const flap = wingPlane(wingSpan * 0.94, dims.wing.chord * 0.4, dims.wing.thick * 0.62);
  flap.translate(0, dims.wing.y - 0.035, dims.wing.z - dims.wing.chord * 0.2);
  add("carbon", flap);
  if (dims.wing.gurney) {
    add("carbon", box(wingSpan * 0.9, 0.035, 0.012, 0, dims.wing.y + 0.03, dims.wing.z - dims.wing.chord * 0.66));
  }
  if (dims.wing.dual) {
    const upper = wingPlane(wingSpan * 0.7, dims.wing.chord * 0.4, dims.wing.thick * 0.7);
    upper.translate(0, dims.wing.y + 0.12, dims.wing.z - dims.wing.chord * 0.06);
    add("carbon", upper);
  }
  for (const side of [-1, 1]) {
    add(
      "carbon",
      box(0.016, dims.wing.thick * 4 + 0.08, dims.wing.chord * 0.95,
        side * wingSpan * 0.5, dims.wing.y + 0.01, dims.wing.z - dims.wing.chord * 0.12),
    );
    // Pylons span from the body surface at the wing station to the wing
    // itself, whichever is higher — some mounts sit on the deck, some (LMP
    // style) hang below it.
    const deckY = dims.wing.deckY;
    const baseY = Math.min(deckY, dims.wing.y);
    const topY = Math.max(deckY, dims.wing.y);
    const pylonH = Math.max(0.14, topY - baseY + 0.1);
    const pylonY = baseY + pylonH * 0.5 - (dims.wing.y < deckY ? 0.05 : 0);
    if (dims.wing.swan) {
      // Swan-neck: stanchions hang from above and meet the wing's upper face.
      add("carbon", box(0.03, pylonH, 0.05, side * dims.rearW * 0.5, pylonY + pylonH * 0.1, dims.wing.z + 0.06, 0.1));
      add("carbon", box(0.03, 0.1, dims.wing.chord * 0.5, side * dims.rearW * 0.5, dims.wing.y + 0.04, dims.wing.z + 0.02));
    } else {
      add("carbon", box(0.032, pylonH, 0.05, side * dims.rearW * 0.46, pylonY, dims.wing.z + 0.04));
    }
  }

  // Shark fin / dorsal blade.
  if (dims.fin) {
    const finH = dims.roofY - dims.deckY + 0.16;
    const shape = new THREE.BufferGeometry();
    const verts = new Float32Array([
      0, dims.deckY + 0.02, rz + 0.1,
      0, dims.roofY - 0.02, rz + 0.5,
      0, dims.roofY - 0.06, dims.wing.z + 0.1,
      0, dims.deckY + 0.02, dims.wing.z + 0.08,
    ]);
    shape.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    shape.setIndex([0, 1, 2, 0, 2, 3]);
    shape.computeVertexNormals();
    const finL = shape.clone();
    finL.translate(0.012, 0, 0);
    const finR = shape.clone();
    finR.translate(-0.012, 0, 0);
    shape.dispose();
    add("carbon", finL);
    add("carbon", finR);
    void finH;
  }

  // Mirrors on stalks at the base of the A-pillars.
  for (const side of [-1, 1]) {
    add("dark", box(0.08, 0.018, 0.02, side * dims.mirrorX, dims.mirrorY, dims.mirrorZ));
    add("carbon", box(0.1, 0.05, 0.07, side * (dims.mirrorX + 0.06), dims.mirrorY + 0.02, dims.mirrorZ + 0.01, 0, side * 0.12));
    add("dark", box(0.055, 0.03, 0.01, side * (dims.mirrorX + 0.07), dims.mirrorY + 0.02, dims.mirrorZ + 0.045, 0, side * 0.12));
  }

  // Cabin tub: dark floor visible through the glass so the greenhouse is not
  // an empty shell, plus the dash cowl at the base of the windshield.
  add("dark", box(dims.halfWidth * 1.2, 0.1, 2.1, 0, spec.floor + 0.16, (fz + rz) * 0.5));
  add("dark", box(dims.halfWidth * 1.1, 0.24, 0.16, 0, spec.floor + 0.34, 0.52, 0.35));

  // Side intakes ahead of the rear wheels: a framed scoop, not a flat decal.
  for (const side of [-1, 1]) {
    const scoopX = side * dims.rearW * 0.99;
    const frame = box(0.04, 0.17, 0.34, scoopX, spec.floor + 0.34, rz + 0.62);
    add("carbon", frame);
    const mouth = box(0.06, 0.1, 0.24, scoopX - side * 0.03, spec.floor + 0.34, rz + 0.62);
    add("dark", mouth);
    add("accent", box(0.03, 0.02, 0.2, scoopX + side * 0.02, spec.floor + 0.41, rz + 0.62));
  }

  // Front bumper openings.
  const mouthY = spec.floor + 0.16;
  add("dark", box(dims.halfWidth * 0.9, 0.16, 0.08, 0, mouthY, dims.tipZ - 0.06));
  for (const side of [-1, 1]) {
    add("dark", box(0.26, 0.13, 0.08, side * dims.halfWidth * 0.62, mouthY + 0.04, dims.tipZ - 0.2));
    add("carbon", box(0.3, 0.04, 0.06, side * dims.halfWidth * 0.62, mouthY + 0.12, dims.tipZ - 0.18));
  }

  // Bonnet vents.
  add("dark", box(0.34, 0.03, 0.26, 0, stationAt(spec, fz + 0.1, "y") + 0.02, fz + 0.1));
  for (const side of [-1, 1]) {
    add("dark", box(0.14, 0.03, 0.3, side * dims.frontW * 0.52, stationAt(spec, fz - 0.1, "y") + 0.04, fz - 0.16, 0, 0, side * 0.12));
  }

  // Exhaust tips.
  for (const x of dims.exhaustXs) {
    const bell = new THREE.CylinderGeometry(0.05, 0.062, 0.14, 12);
    bell.rotateX(Math.PI / 2);
    const bellFlat = bell.toNonIndexed();
    bell.dispose();
    bellFlat.deleteAttribute("uv");
    bellFlat.translate(x, dims.exhaustY, dims.tailZ - 0.02);
    add("chrome", bellFlat);
    const bore = new THREE.CylinderGeometry(0.04, 0.04, 0.05, 12);
    bore.rotateX(Math.PI / 2);
    const boreFlat = bore.toNonIndexed();
    bore.dispose();
    boreFlat.deleteAttribute("uv");
    boreFlat.translate(x, dims.exhaustY, dims.tailZ - 0.05);
    add("dark", boreFlat);
  }

  // Headlight housings and lenses, seated on the leading edge of the bonnet.
  for (const side of [-1, 1]) {
    const lampX = side * dims.lampX;
    add("dark", box(dims.lampW, 0.1, 0.14, lampX, dims.lampY, dims.lampZ, -0.16, side * -0.1, side * -0.06));
    add("lamp", box(dims.lampW * 0.8, 0.045, 0.1, lampX, dims.lampY + 0.03, dims.lampZ + 0.02, -0.16, side * -0.1, side * -0.06));
    // Rear light clusters set into the tail panel.
    add("dark", box(dims.tailW, 0.11, 0.08, side * dims.rearW * 0.58, dims.tailY, dims.tailZLamp - 0.02, 0, side * 0.14));
    add("tail", box(dims.tailW * 0.8, 0.05, 0.06, side * dims.rearW * 0.58, dims.tailY + 0.01, dims.tailZLamp - 0.05, 0, side * 0.14));
  }
  add("tail", box(dims.rearW * 0.5, 0.04, 0.05, 0, dims.tailY + 0.07, dims.tailZLamp - 0.05));

  const out: Partial<Record<CarRole, THREE.BufferGeometry>> = {};
  for (const role of Object.keys(buckets) as CarRole[]) {
    const list = buckets[role];
    if (!list.length) continue;
    // mergeGeometries needs a consistent index + attribute set; boxes are
    // non-indexed while lofted/extruded parts are indexed, and only position
    // + normal survive (carbon UVs are projected after every merge).
    const flat = list.map((g) => {
      const non = g.index ? g.toNonIndexed() : g;
      if (non !== g) g.dispose();
      for (const key of Object.keys(non.attributes)) {
        if (key !== "position" && key !== "normal") non.deleteAttribute(key);
      }
      if (!non.getAttribute("normal")) non.computeVertexNormals();
      return non;
    });
    const merged = mergeGeometries(flat, false);
    for (const g of flat) g.dispose();
    if (!merged) throw new Error(`detail merge failed for ${role}`);
    out[role] = merged;
  }
  return out;
}

function dimsFor(spec: CarSpec): CarDims {
  const keys = spec.keys;
  const tipZ = keys[keys.length - 1]!.z;
  const tailZ = keys[0]!.z;
  const frontW = stationAt(spec, spec.frontAxleZ, "w");
  const rearW = stationAt(spec, spec.rearAxleZ, "w");
  const roofKey = keys.reduce((a, b) => (b.y > a.y && b.z > -1.2 && b.z < 0.9 ? b : a), keys[0]!);
  const deckY = stationAt(spec, spec.rearAxleZ + 0.1, "y");
  const beltY = stationAt(spec, 0.1, "fY");
  const id = spec.id;
  const isLong = id === "surge";
  const isWide = id === "aegis";
  const isShort = id === "vanta";
  const wingZ = spec.rearAxleZ - (isLong ? 0.62 : isShort ? 0.5 : 0.55);
  const wingY = roofKey.y - (isLong ? 0.2 : isShort ? 0.02 : 0.1);
  const halfWidth = Math.max(frontW, rearW);
  const lampZ = tipZ - 0.26;
  return {
    halfWidth,
    length: tipZ - tailZ,
    roofY: roofKey.y,
    deckY,
    beltY,
    floorY: spec.floor,
    tipZ,
    tailZ,
    frontW,
    rearW,
    frontAxleZ: spec.frontAxleZ,
    rearAxleZ: spec.rearAxleZ,
    lampY: stationAt(spec, lampZ, "y") + 0.01,
    lampZ,
    lampW: isWide ? 0.34 : isShort ? 0.26 : 0.3,
    lampX: stationAt(spec, lampZ, "w") * 0.52,
    tailY: stationAt(spec, tailZ + 0.05, "y") - 0.11,
    tailZLamp: tailZ - 0.01,
    tailW: isWide ? 0.44 : isShort ? 0.36 : 0.4,
    mirrorY: beltY + 0.04,
    mirrorZ: 0.42,
    mirrorX: stationAt(spec, 0.42, "w") * 0.86,
    plateY: stationAt(spec, tailZ + 0.08, "y") - 0.2,
    numberScale: isWide ? 1.1 : 1,
    exhaustXs: isShort ? [0] : isWide ? [-0.44, 0.44] : isLong ? [-0.4, -0.18, 0.18, 0.4] : [-0.26, 0.26],
    exhaustY: spec.floor + 0.22,
    glowScale: halfWidth,
    contactW: halfWidth * 1.7,
    contactL: (tipZ - tailZ) * 0.94,
    wing: {
      span: rearW * (isWide ? 1.86 : isShort ? 1.92 : isLong ? 1.7 : 1.74),
      chord: isLong ? 0.34 : isShort ? 0.42 : isWide ? 0.4 : 0.34,
      y: wingY,
      z: wingZ,
      deckY: stationAt(spec, wingZ, "y"),
      thick: isShort || isWide ? 0.055 : 0.045,
      dual: isShort,
      swan: isWide || isLong,
      gurney: isShort || isWide,
    },
    fin: isLong,
    canards: isWide || isShort,
    splitter: isWide ? 0.5 : isShort ? 0.42 : 0.46,
    skirt: 1,
    diffuserFins: isLong ? 5 : isWide ? 6 : 4,
    diffuserRise: 0.34,
  };
}

export function buildCarGeometry(vehicleId: string): CarGeometry {
  const spec = carSpec(vehicleId);
  const dims = dimsFor(spec);
  const hull = buildHull(sampleHull(spec));
  const details = detailGeometry(spec, dims);
  const parts: Partial<Record<CarRole, THREE.BufferGeometry>> = {};
  for (const role of [...Object.keys(hull), ...Object.keys(details)] as CarRole[]) {
    const a = hull[role];
    const b = details[role];
    if (!a && !b) continue;
    if (a && b) {
      const merged = mergeGeometries([a, b], false);
      a.dispose();
      b.dispose();
      if (!merged) throw new Error(`merge failed for ${role}`);
      parts[role] = merged;
    } else {
      parts[role] = (a ?? b)!;
    }
  }
  // Carbon gets planar UVs once, after hull and details are in one buffer.
  const carbon = parts.carbon;
  if (carbon) boxUV(carbon, 14);

  const wheels: WheelBuild[] = [];
  const spots: Array<{ x: number; z: number; steered: boolean; tire: TireSpec }> = [
    { x: dims.frontW - 0.03 - spec.tireFront.half, z: spec.frontAxleZ, steered: true, tire: spec.tireFront },
    { x: -(dims.frontW - 0.03 - spec.tireFront.half), z: spec.frontAxleZ, steered: true, tire: spec.tireFront },
    { x: dims.rearW - 0.03 - spec.tireRear.half, z: spec.rearAxleZ, steered: false, tire: spec.tireRear },
    { x: -(dims.rearW - 0.03 - spec.tireRear.half), z: spec.rearAxleZ, steered: false, tire: spec.tireRear },
  ];
  const built = new Map<string, { tire: THREE.BufferGeometry; rims: [THREE.BufferGeometry, THREE.BufferGeometry]; disc: THREE.BufferGeometry; caliper: THREE.BufferGeometry }>();
  for (const spot of spots) {
    const key = `${spot.tire.r}:${spot.tire.half}`;
    let set = built.get(key);
    if (!set) {
      set = {
        tire: tireGeometry(spot.tire),
        rims: [rimGeometry(spec.rim, spot.tire, -1), rimGeometry(spec.rim, spot.tire, 1)],
        disc: discGeometry(spec.rim),
        caliper: caliperGeometry(spec.rim),
      };
      built.set(key, set);
    }
    wheels.push({
      x: spot.x,
      y: CONTACT + spot.tire.r,
      z: spot.z,
      steered: spot.steered,
      radius: spot.tire.r,
      tire: set.tire,
      rim: set.rims[spot.x > 0 ? 1 : 0]!,
      disc: set.disc,
      caliper: set.caliper,
    });
  }
  return { parts, wheels, dims };
}

/** Half width of the body at station z — for placing decals on the surface. */
export function bodyWidthAt(vehicleId: string, z: number): number {
  return stationAt(carSpec(vehicleId), z, "w");
}

/** Height of the centreline surface at station z — hood, roof or deck. */
export function topYAt(vehicleId: string, z: number): number {
  return stationAt(carSpec(vehicleId), z, "y");
}

/** Contact-patch decals live in root space, just above the asphalt. */
export const WHEEL_CONTACT_Y = CONTACT;
