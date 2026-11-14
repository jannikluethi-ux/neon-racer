import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { WHEEL_CONTACT_Y } from "./contact";
import { buildBody } from "./car-bodies";

/**
 * Authored vehicle geometry.
 *
 * The body of each car is built by its own constructor in car-bodies.ts.
 * The station table below is only the physics contact layout: axle stations,
 * tire size and body half-width. Visual meshes do not loft those stations.
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
};


function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
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


// ---------------------------------------------------------------------------
// Detail geometry
// ---------------------------------------------------------------------------


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
 * Each car is authored as its own station table. Wheelbase is the distance
 * between the axle stations, not a separate scale. Body width is twice the
 * widest station half-width. Floor height is above the tire-contact origin;
 * the asphalt deck sits 0.03 m above that origin, so floor-to-tarmac clearance
 * is floor − 0.03 m (about 0.11–0.12 m), not the floor number itself.
 *
 * Measured from these stations:
 *   VECTOR  wheelbase 2.50 m, width 2.14 m, floor 0.145 m
 *   VANTA   wheelbase 2.38 m, width 2.24 m, floor 0.150 m
 *   SURGE   wheelbase 2.82 m, width 2.20 m, floor 0.140 m
 *   AEGIS   wheelbase 2.52 m, width 2.36 m, floor 0.150 m
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
    tireFront: { r: 0.345, half: 0.13, rimR: 0.245, grooves: 3 },
    tireRear: { r: 0.345, half: 0.15, rimR: 0.245, grooves: 3 },
    rim: { spokes: 7, spokeW: 0.052, spokeT: 0.036, face: 0xdde5ec, barrel: 0xc3ccd4, discR: 0.2, caliper: 0x2ee6ff, lipSteps: 2 },
    keys: [
      { z: -2.12, y: 0.62, w: 0.88, cab: 0.06, fY: 0.66, zone: "tail" },
      { z: -1.98, y: 0.7, w: 0.98, cab: 0.1, fY: 0.74, zone: "tail" },
      { z: -1.78, y: 0.78, w: 1.04, cab: 0.14, fY: 0.82, zone: "deck" },
      { z: -1.55, y: 0.82, w: 1.07, cab: 0.18, fY: 0.86, zone: "deck" },
      { z: -1.35, y: 0.86, w: 1.07, cab: 0.22, fY: 0.9, zone: "deck" },
      { z: -1.1, y: 1.02, w: 1.02, cab: 0.36, fY: 0.92, zone: "glassR" },
      { z: -0.85, y: 1.16, w: 0.96, cab: 0.48, fY: 0.9, zone: "glassR" },
      { z: -0.58, y: 1.24, w: 0.9, cab: 0.56, fY: 0.88, zone: "pillarC" },
      { z: -0.4, y: 1.26, w: 0.88, cab: 0.58, fY: 0.88, zone: "roof" },
      { z: -0.1, y: 1.26, w: 0.88, cab: 0.58, fY: 0.88, zone: "roof" },
      { z: 0.14, y: 1.22, w: 0.9, cab: 0.54, fY: 0.88, zone: "roof" },
      { z: 0.3, y: 1.08, w: 0.92, cab: 0.42, fY: 0.88, zone: "pillarA" },
      { z: 0.48, y: 0.92, w: 0.94, cab: 0.28, fY: 0.86, zone: "glassF" },
      { z: 0.7, y: 0.78, w: 0.95, cab: 0.14, fY: 0.82, zone: "glassF" },
      { z: 0.9, y: 0.7, w: 0.97, cab: 0.08, fY: 0.78, zone: "hood" },
      { z: 1.15, y: 0.66, w: 1.01, cab: 0.05, fY: 0.74, zone: "hood" },
      { z: 1.45, y: 0.62, w: 1.0, cab: 0.04, fY: 0.7, zone: "hood" },
      { z: 1.78, y: 0.56, w: 0.95, cab: 0.03, fY: 0.62, zone: "nose" },
      { z: 2.02, y: 0.5, w: 0.86, cab: 0.02, fY: 0.54, zone: "nose" },
      { z: 2.16, y: 0.44, w: 0.72, cab: 0.02, fY: 0.48, zone: "nose" },
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
    tireFront: { r: 0.335, half: 0.125, rimR: 0.238, grooves: 2 },
    tireRear: { r: 0.335, half: 0.155, rimR: 0.238, grooves: 2 },
    rim: { spokes: 5, spokeW: 0.09, spokeT: 0.05, face: 0x9aa4ae, barrel: 0x8f99a3, discR: 0.192, caliper: 0xff4d24, lipSteps: 2 },
    keys: [
      { z: -1.96, y: 0.92, w: 0.86, cab: 0.12, fY: 0.88, zone: "tail" },
      { z: -1.84, y: 0.98, w: 0.98, cab: 0.16, fY: 0.94, zone: "tail" },
      { z: -1.66, y: 1.02, w: 1.06, cab: 0.22, fY: 0.98, zone: "deck" },
      { z: -1.45, y: 1.06, w: 1.11, cab: 0.3, fY: 1.0, zone: "deck" },
      { z: -1.3, y: 1.08, w: 1.12, cab: 0.36, fY: 1.02, zone: "deck" },
      { z: -1.06, y: 1.2, w: 1.06, cab: 0.52, fY: 1.02, zone: "glassR" },
      { z: -0.8, y: 1.32, w: 1.0, cab: 0.62, fY: 1.0, zone: "glassR" },
      { z: -0.52, y: 1.36, w: 0.94, cab: 0.66, fY: 0.98, zone: "pillarC" },
      { z: -0.34, y: 1.38, w: 0.92, cab: 0.68, fY: 0.98, zone: "roof" },
      { z: -0.02, y: 1.38, w: 0.92, cab: 0.68, fY: 0.98, zone: "roof" },
      { z: 0.2, y: 1.34, w: 0.94, cab: 0.64, fY: 0.98, zone: "roof" },
      { z: 0.34, y: 1.22, w: 0.96, cab: 0.52, fY: 0.98, zone: "pillarA" },
      { z: 0.5, y: 1.08, w: 0.97, cab: 0.36, fY: 0.98, zone: "glassF" },
      { z: 0.7, y: 0.96, w: 0.98, cab: 0.18, fY: 0.96, zone: "hood" },
      { z: 0.88, y: 0.9, w: 1.0, cab: 0.1, fY: 0.94, zone: "hood" },
      { z: 1.08, y: 0.86, w: 1.04, cab: 0.06, fY: 0.92, zone: "hood" },
      { z: 1.34, y: 0.84, w: 1.02, cab: 0.04, fY: 0.88, zone: "nose" },
      { z: 1.62, y: 0.82, w: 0.96, cab: 0.03, fY: 0.84, zone: "nose" },
      { z: 1.84, y: 0.8, w: 0.86, cab: 0.03, fY: 0.82, zone: "nose" },
      { z: 1.96, y: 0.78, w: 0.7, cab: 0.02, fY: 0.8, zone: "nose" },
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
    tireFront: { r: 0.34, half: 0.12, rimR: 0.242, grooves: 3 },
    tireRear: { r: 0.34, half: 0.16, rimR: 0.242, grooves: 3 },
    rim: { spokes: 10, spokeW: 0.03, spokeT: 0.024, face: 0xe8eef4, barrel: 0xb9c2ca, discR: 0.205, caliper: 0xffe14a, lipSteps: 3 },
    keys: [
      { z: -2.4, y: 0.52, w: 0.86, cab: 0.06, fY: 0.58, zone: "tail" },
      { z: -2.24, y: 0.56, w: 0.98, cab: 0.08, fY: 0.62, zone: "tail" },
      { z: -2.0, y: 0.6, w: 1.06, cab: 0.1, fY: 0.68, zone: "deck" },
      { z: -1.72, y: 0.62, w: 1.1, cab: 0.12, fY: 0.72, zone: "deck" },
      { z: -1.5, y: 0.64, w: 1.1, cab: 0.16, fY: 0.74, zone: "deck" },
      { z: -1.2, y: 0.7, w: 1.06, cab: 0.22, fY: 0.72, zone: "glassR" },
      { z: -0.9, y: 0.82, w: 1.0, cab: 0.3, fY: 0.7, zone: "glassR" },
      { z: -0.6, y: 0.9, w: 0.94, cab: 0.34, fY: 0.68, zone: "pillarC" },
      { z: -0.4, y: 0.92, w: 0.9, cab: 0.36, fY: 0.66, zone: "roof" },
      { z: -0.08, y: 0.93, w: 0.9, cab: 0.36, fY: 0.66, zone: "roof" },
      { z: 0.18, y: 0.9, w: 0.92, cab: 0.32, fY: 0.66, zone: "roof" },
      { z: 0.34, y: 0.82, w: 0.94, cab: 0.24, fY: 0.66, zone: "pillarA" },
      { z: 0.54, y: 0.72, w: 0.96, cab: 0.16, fY: 0.66, zone: "glassF" },
      { z: 0.78, y: 0.62, w: 0.98, cab: 0.08, fY: 0.66, zone: "hood" },
      { z: 1.0, y: 0.56, w: 1.0, cab: 0.05, fY: 0.64, zone: "hood" },
      { z: 1.32, y: 0.52, w: 1.03, cab: 0.04, fY: 0.62, zone: "hood" },
      { z: 1.66, y: 0.48, w: 1.02, cab: 0.03, fY: 0.58, zone: "nose" },
      { z: 2.0, y: 0.44, w: 0.96, cab: 0.02, fY: 0.52, zone: "nose" },
      { z: 2.28, y: 0.4, w: 0.84, cab: 0.02, fY: 0.46, zone: "nose" },
      { z: 2.44, y: 0.36, w: 0.64, cab: 0.02, fY: 0.4, zone: "nose" },
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
    tireFront: { r: 0.35, half: 0.15, rimR: 0.25, grooves: 4 },
    tireRear: { r: 0.35, half: 0.15, rimR: 0.25, grooves: 4 },
    rim: { spokes: 6, spokeW: 0.07, spokeT: 0.045, face: 0xc8a06a, barrel: 0xb08c58, discR: 0.215, caliper: 0x9fd4ff, lipSteps: 2 },
    keys: [
      { z: -2.14, y: 0.96, w: 0.96, cab: 0.22, fY: 0.92, zone: "tail" },
      { z: -2.0, y: 1.02, w: 1.06, cab: 0.28, fY: 0.98, zone: "tail" },
      { z: -1.8, y: 1.08, w: 1.14, cab: 0.36, fY: 1.04, zone: "deck" },
      { z: -1.56, y: 1.12, w: 1.18, cab: 0.42, fY: 1.08, zone: "deck" },
      { z: -1.32, y: 1.14, w: 1.18, cab: 0.5, fY: 1.1, zone: "deck" },
      { z: -1.05, y: 1.2, w: 1.14, cab: 0.62, fY: 1.12, zone: "glassR" },
      { z: -0.8, y: 1.24, w: 1.1, cab: 0.72, fY: 1.14, zone: "glassR" },
      { z: -0.54, y: 1.26, w: 1.04, cab: 0.78, fY: 1.16, zone: "pillarC" },
      { z: -0.36, y: 1.26, w: 1.02, cab: 0.78, fY: 1.16, zone: "roof" },
      { z: -0.04, y: 1.26, w: 1.02, cab: 0.78, fY: 1.16, zone: "roof" },
      { z: 0.2, y: 1.26, w: 1.04, cab: 0.76, fY: 1.16, zone: "roof" },
      { z: 0.34, y: 1.22, w: 1.06, cab: 0.7, fY: 1.14, zone: "pillarA" },
      { z: 0.52, y: 1.16, w: 1.08, cab: 0.58, fY: 1.12, zone: "glassF" },
      { z: 0.74, y: 1.08, w: 1.09, cab: 0.4, fY: 1.08, zone: "glassF" },
      { z: 0.94, y: 1.02, w: 1.1, cab: 0.22, fY: 1.04, zone: "hood" },
      { z: 1.2, y: 0.98, w: 1.13, cab: 0.12, fY: 1.0, zone: "hood" },
      { z: 1.5, y: 0.94, w: 1.12, cab: 0.06, fY: 0.96, zone: "hood" },
      { z: 1.82, y: 0.9, w: 1.06, cab: 0.04, fY: 0.92, zone: "nose" },
      { z: 2.06, y: 0.86, w: 0.98, cab: 0.03, fY: 0.88, zone: "nose" },
      { z: 2.2, y: 0.82, w: 0.8, cab: 0.03, fY: 0.84, zone: "nose" },
    ],
  },
};

export function carSpec(id: string): CarSpec {
  return SPECS[id as CarId] ?? SPECS.vector;
}

/**
 * Where the tires actually sit. Shared by the mesh builder and the kerb
 * sampler so a wheel cannot "touch" a kerb the model has not reached.
 * `frontX` / `rearX` are positive half-tracks (driver's left is +X).
 */
export type WheelLayout = {
  frontX: number;
  rearX: number;
  frontZ: number;
  rearZ: number;
  frontRadius: number;
  rearRadius: number;
  /** Widest body half-width (m). Full width is twice this. */
  halfWidth: number;
  /** Axle-to-axle distance (m). */
  wheelbase: number;
  /** Floor above the tire-contact origin (m). */
  floorY: number;
};

export function wheelLayout(vehicleId: string): WheelLayout {
  const spec = carSpec(vehicleId);
  const frontW = stationAt(spec, spec.frontAxleZ, "w");
  const rearW = stationAt(spec, spec.rearAxleZ, "w");
  let halfWidth = 0;
  for (const key of spec.keys) if (key.w > halfWidth) halfWidth = key.w;
  return {
    frontX: frontW - 0.03 - spec.tireFront.half,
    rearX: rearW - 0.03 - spec.tireRear.half,
    frontZ: spec.frontAxleZ,
    rearZ: spec.rearAxleZ,
    frontRadius: spec.tireFront.r,
    rearRadius: spec.tireRear.r,
    halfWidth,
    wheelbase: spec.frontAxleZ - spec.rearAxleZ,
    floorY: spec.floor,
  };
}

export function isCarId(id: string): id is CarId {
  return id in SPECS;
}

function stationAt(spec: CarSpec, z: number, field: "y" | "w" | "cab" | "fY"): number {
  return catmullField(spec.keys, z, field);
}


export function buildCarGeometry(vehicleId: string): CarGeometry {
  const spec = carSpec(vehicleId);
  const layout = wheelLayout(spec.id);
  const body = buildBody(spec.id, layout);
  const parts = body.parts;
  const dims = body.dims;

  const wheels: WheelBuild[] = [];
  const spots: Array<{ x: number; z: number; steered: boolean; tire: TireSpec }> = [
    { x: layout.frontX, z: layout.frontZ, steered: true, tire: spec.tireFront },
    { x: -layout.frontX, z: layout.frontZ, steered: true, tire: spec.tireFront },
    { x: layout.rearX, z: layout.rearZ, steered: false, tire: spec.tireRear },
    { x: -layout.rearX, z: layout.rearZ, steered: false, tire: spec.tireRear },
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
      y: WHEEL_CONTACT_Y + spot.tire.r,
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

export { WHEEL_CONTACT_Y };
