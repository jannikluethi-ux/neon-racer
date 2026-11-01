import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { CarState } from "./types";
import type { Gate, Sample, Track } from "./track";
import { sampleAt } from "./track";
import { themeFor, type TrackTheme } from "./track-def";
import { addScenery } from "./scenery";
import { VECTOR, type BodyStyle } from "./vehicle-def";

export type CarView = {
	root: THREE.Group;
	chassis: THREE.Group;
	wheels: THREE.Object3D[];
	frontPivots: THREE.Object3D[];
	brakeMat: THREE.MeshStandardMaterial;
	paint: THREE.MeshStandardMaterial;
	boost: THREE.Object3D;
	glow: THREE.Mesh;
	headLight: THREE.SpotLight;
	tailLight: THREE.PointLight;
	boostLight: THREE.PointLight;
	hero: boolean;
};

export type CarVis = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  spin: number;
  steer: number;
};

export type SceneBundle = {
  scene: THREE.Scene;
  cars: CarView[];
  sparks: DriftSparks;
  smoke: TireSmoke;
  skids: SkidMarks;
  flashes: ImpactFlashes;
  dressing: THREE.Group;
  miniTrack: Path2D | null;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
};

export type CarPaint = {
  color: number;
  body: BodyStyle;
  rival: boolean;
};

function tireLathe(outer: number, halfW: number): THREE.BufferGeometry {
	const r = outer;
	const pts = [
		new THREE.Vector2(r * 0.7, -halfW * 0.42),
		new THREE.Vector2(r * 0.8, -halfW * 0.92),
		new THREE.Vector2(r * 0.93, -halfW * 0.62),
		new THREE.Vector2(r, -halfW * 0.22),
		new THREE.Vector2(r, halfW * 0.22),
		new THREE.Vector2(r * 0.93, halfW * 0.62),
		new THREE.Vector2(r * 0.8, halfW * 0.92),
		new THREE.Vector2(r * 0.7, halfW * 0.42),
	];
	const g = new THREE.LatheGeometry(pts, 32);
	g.rotateZ(Math.PI / 2);
	return g;
}

function racingRim(spokes: number, spokeW: number, spokeT: number, lipR: number): THREE.BufferGeometry {
	const parts: THREE.BufferGeometry[] = [];
	const take = (g: THREE.BufferGeometry) => {
		const flat = g.toNonIndexed();
		g.dispose();
		parts.push(flat);
	};
	for (const side of [-1, 1]) {
		const lip = new THREE.TorusGeometry(lipR, 0.02, 6, 24);
		lip.rotateY(Math.PI / 2);
		lip.translate(side * 0.02, 0, 0);
		take(lip);
		const cap = new THREE.CylinderGeometry(0.055, 0.07, 0.05, 12);
		cap.rotateZ(Math.PI / 2);
		cap.translate(side * 0.04, 0, 0);
		take(cap);
	}
	const bolt = new THREE.CylinderGeometry(0.09, 0.09, 0.03, 12);
	bolt.rotateZ(Math.PI / 2);
	take(bolt);
	for (let i = 0; i < spokes; i++) {
		const spoke = new THREE.BoxGeometry(spokeT, lipR * 0.9, spokeW);
		spoke.translate(0, lipR * 0.48, 0);
		spoke.rotateX((i * Math.PI * 2) / spokes);
		take(spoke);
	}
	const merged = mergeGeometries(parts, false);
	for (const p of parts) p.dispose();
	if (!merged) throw new Error("rim merge failed");
	return merged;
}

const geos = {
	tire: tireLathe(0.36, 0.13),
	tireWide: tireLathe(0.36, 0.155),
	tireSlim: tireLathe(0.36, 0.115),
	rimVector: racingRim(7, 0.055, 0.036, 0.22),
	rimVanta: racingRim(5, 0.09, 0.05, 0.218),
	rimSurge: racingRim(6, 0.04, 0.026, 0.224),
	rimAegis: racingRim(6, 0.072, 0.042, 0.216),
	disc: (() => {
		const g = new THREE.CylinderGeometry(0.155, 0.155, 0.016, 18);
		g.rotateZ(Math.PI / 2);
		return g;
	})(),
	arm: new THREE.BoxGeometry(0.72, 0.045, 0.045),
	well: (() => {
		const g = new THREE.CylinderGeometry(0.48, 0.48, 0.18, 14, 1, true, 0, Math.PI);
		g.rotateZ(Math.PI / 2);
		return g;
	})(),
	caliper: new THREE.BoxGeometry(0.07, 0.11, 0.16),
	glow: new THREE.BoxGeometry(1.35, 0.04, 2.6),
	boost: new THREE.ConeGeometry(0.14, 1.15, 7),
	lens: new THREE.BoxGeometry(1, 1, 1),
	bezel: new THREE.BoxGeometry(1, 1, 1),
	tailLens: new THREE.BoxGeometry(1, 1, 1),
	bell: (() => {
		const g = new THREE.CylinderGeometry(0.046, 0.064, 0.13, 10);
		g.rotateX(Math.PI / 2);
		return g;
	})(),
	bore: (() => {
		const g = new THREE.CylinderGeometry(0.028, 0.032, 0.04, 8);
		g.rotateX(Math.PI / 2);
		return g;
	})(),
	outlet: new THREE.TorusGeometry(0.044, 0.006, 5, 12),
	arch: (() => {
		const g = new THREE.TorusGeometry(0.42, 0.028, 5, 14, Math.PI);
		g.rotateY(Math.PI / 2);
		return g;
	})(),
	contact: new THREE.CircleGeometry(1.35, 18),
};

geos.boost.rotateX(-Math.PI / 2);

function boxAt(w: number, h: number, d: number, x: number, y: number, z: number, rx = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.deleteAttribute("uv");
  if (rx !== 0) g.rotateX(rx);
  g.translate(x, y, z);
  return g;
}

// Car local axes: +Z nose, -Z tail, +X driver's left, +Y up.
type Silhouette = "balanced" | "sharp" | "long" | "wide";

function silhouetteOf(style: BodyStyle): Silhouette {
  const [x, y, z] = style.body;
  if (z >= 1.15) return "long";
  if (x >= 1.2) return "wide";
  // Keep the short-wheelbase car a closed GT silhouette. The lower threshold
  // reserves the sharper profile for a future open-cockpit class instead of
  // making today's grid look like anonymous formula cars.
  if (y <= 0.8) return "sharp";
  return "balanced";
}

type Key = { z: number; y: number; w: number; cab: number; fY: number; zone: string };
type Pt = [number, number];
type Ring = { z: number; y: number; w: number; cab: number; fY: number; zone: string; loop: Pt[]; sill: number };

function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

function catmull(keys: Key[], z: number, field: "y" | "w" | "cab" | "fY"): number {
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

function zoneAt(keys: Key[], z: number): string {
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

function baseKeys(): Key[] {
  return [
    { z: -2.08, y: 0.62, w: 0.86, cab: 0.06, fY: 0.74, zone: "tail" },
    { z: -1.84, y: 0.68, w: 0.98, cab: 0.12, fY: 0.9, zone: "deck" },
    { z: -1.52, y: 0.7, w: 1.08, cab: 0.16, fY: 1.16, zone: "deck" },
    { z: -1.2, y: 0.86, w: 0.9, cab: 0.3, fY: 0.94, zone: "glassR" },
    { z: -0.86, y: 1.08, w: 0.74, cab: 0.38, fY: 0.82, zone: "glassR" },
    { z: -0.48, y: 1.2, w: 0.66, cab: 0.4, fY: 0.76, zone: "roof" },
    { z: -0.1, y: 1.2, w: 0.64, cab: 0.38, fY: 0.76, zone: "roof" },
    { z: 0.24, y: 1.0, w: 0.7, cab: 0.32, fY: 0.78, zone: "glassF" },
    { z: 0.54, y: 0.7, w: 0.78, cab: 0.16, fY: 0.86, zone: "glassF" },
    { z: 0.84, y: 0.54, w: 0.88, cab: 0.08, fY: 1.0, zone: "hood" },
    { z: 1.14, y: 0.5, w: 1.02, cab: 0.06, fY: 1.14, zone: "nose" },
    { z: 1.48, y: 0.46, w: 0.82, cab: 0.04, fY: 0.72, zone: "nose" },
    { z: 1.82, y: 0.42, w: 0.58, cab: 0.03, fY: 0.5, zone: "nose" },
    { z: 2.1, y: 0.4, w: 0.42, cab: 0.02, fY: 0.44, zone: "nose" },
  ];
}

function keysFor(kind: Silhouette): Key[] {
  const src = baseKeys();
  if (kind === "sharp") {
    return src.map((k) => ({
      ...k,
      z: k.z * 1.02,
      y: k.y > 1.05 ? k.y * 0.96 : k.y * 0.98,
      w: k.w > 0.8 ? k.w * 1.12 : k.w * 0.9,
      cab: k.cab * 0.82,
      fY: k.fY > 0.9 ? k.fY * 1.06 : k.fY,
    }));
  }
  if (kind === "long") {
    return src.map((k) => ({
      ...k,
      z: k.z * 0.9 + (k.z > 0.7 ? 0.16 : k.z < -1.3 ? -0.1 : 0),
      y: k.y > 1.05 ? k.y * 0.9 : k.y * 0.98,
      w: k.w * 0.9,
      cab: k.cab * 0.9,
      fY: k.fY * 0.96,
    }));
  }
  if (kind === "wide") {
    return src.map((k) => ({
      ...k,
      z: k.z * 1.02,
      y: k.y * 1.02,
      w: k.w * 1.1,
      cab: k.cab * 1.08,
      fY: k.fY * 1.03,
    }));
  }
  return src;
}

function smoothOpen(pts: Pt[], n: number): Pt[] {
  const out: Pt[] = [];
  const last = pts.length - 1;
  for (let i = 0; i < n; i++) {
    const f = (i / (n - 1)) * last;
    const i1 = Math.min(last - 1, Math.floor(f));
    const local = Math.min(1, f - i1);
    const i0 = Math.max(0, i1 - 1);
    const i2 = Math.min(last, i1 + 1);
    const i3 = Math.min(last, i1 + 2);
    const cm = (k: 0 | 1) => {
      const p0 = pts[i0]![k];
      const p1 = pts[i1]![k];
      const p2 = pts[i2]![k];
      const p3 = pts[i3]![k];
      const tt = local * local;
      const ttt = tt * local;
      return 0.5 * (2 * p1 + (-p0 + p2) * local + (2 * p0 - 5 * p1 + 4 * p2 - p3) * tt + (-p0 + 3 * p1 - 3 * p2 + p3) * ttt);
    };
    out.push([cm(0), cm(1)]);
  }
  out[0] = [pts[0]![0], pts[0]![1]];
  out[n - 1] = [pts[last]![0], pts[last]![1]];
  return out;
}

function ringAt(w: number, yTop: number, fY: number, cab: number): { loop: Pt[]; sill: number } {
  const width = clamp(w, 0.12, 1.42);
  const crown = clamp(yTop, 0.38, 1.42);
  const fender = clamp(fY, 0.42, 1.36);
  const roofHalf = clamp(Math.max(cab * 0.85, 0.05), 0.05, width * 0.48);
  const shoulder = clamp(Math.max(cab * 1.15, width * 0.36), roofHalf + 0.04, width * 0.9);
  const y0 = 0.3;
  const sill = crown > fender + 0.08 ? fender + (crown - fender) * 0.28 : crown + 1;
  const ctrls: Pt[] = [
    [0, y0],
    [width * 0.46, y0 + 0.012],
    [width * 0.78, y0 + 0.055],
    [width * 0.95, y0 + (fender - y0) * 0.5],
    [width, fender],
    [width, fender],
    [width * 0.9, fender + (crown - fender) * 0.22],
    [shoulder, fender + (crown - fender) * 0.58],
    [Math.max(roofHalf, shoulder * 0.7), crown],
    [roofHalf, crown],
    [0, crown],
  ];
  const half = smoothOpen(ctrls, 16);
  let peak = 0;
  for (const p of half) peak = Math.max(peak, p[0]);
  const fit = peak > 0.04 ? width / peak : 1;
  for (let i = 0; i < half.length; i++) {
    const x = clamp(half[i]![0] * fit, 0, width * 1.02);
    const y = clamp(half[i]![1], y0 - 0.01, Math.max(crown, fender) + 0.02);
    half[i] = [x, y];
  }
  half[0] = [0, y0];
  half[half.length - 1] = [0, crown];
  const loop: Pt[] = [];
  for (const p of half) loop.push(p);
  for (let i = half.length - 2; i >= 1; i--) loop.push([-half[i]![0], half[i]![1]]);
  return { loop, sill };
}

function sampleHull(kind: Silhouette): Ring[] {
  const keys = keysFor(kind);
  const z0 = keys[0]!.z;
  const z1 = keys[keys.length - 1]!.z;
  const n = 46;
  const rings: Ring[] = [];
  for (let i = 0; i < n; i++) {
    const z = z0 + ((z1 - z0) * i) / (n - 1);
    const y = clamp(catmull(keys, z, "y"), 0.36, 1.46);
    const w = clamp(catmull(keys, z, "w"), 0.1, 1.42);
    const cab = clamp(catmull(keys, z, "cab"), 0.02, 0.7);
    const fY = clamp(catmull(keys, z, "fY"), 0.4, 1.4);
    const section = ringAt(w, y, fY, cab);
    rings.push({ z, y, w, cab, fY, zone: zoneAt(keys, z), loop: section.loop, sill: section.sill });
  }
  return rings;
}

function loftRings(rings: Ring[]): THREE.BufferGeometry {
  const n = rings[0]!.loop.length;
  const positions: number[] = [];
  const indices: number[] = [];
  for (const ring of rings) {
    for (const p of ring.loop) positions.push(p[0], p[1], ring.z);
  }
  const seg = rings.length - 1;
  for (let s = 0; s < seg; s++) {
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n;
      const a = s * n + i;
      const b = s * n + i2;
      const c = (s + 1) * n + i;
      const d = (s + 1) * n + i2;
      indices.push(a, b, d, a, d, c);
    }
  }
  const noseC = positions.length / 3;
  const nose = rings[rings.length - 1]!;
  positions.push(0, (nose.loop[0]![1] + nose.y) * 0.5, nose.z);
  const last = seg * n;
  for (let i = 0; i < n; i++) indices.push(noseC, last + i, last + ((i + 1) % n));
  const tailC = positions.length / 3;
  const tail = rings[0]!;
  positions.push(0, (tail.loop[0]![1] + tail.y) * 0.5, tail.z);
  for (let i = 0; i < n; i++) indices.push(tailC, (i + 1) % n, i);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function takeVerts(pos: THREE.BufferAttribute, nrm: THREE.BufferAttribute, ids: number[]): THREE.BufferGeometry {
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
}

function splitHull(rings: Ring[]): { paint: THREE.BufferGeometry; carbon: THREE.BufferGeometry; glass: THREE.BufferGeometry } {
  const indexed = loftRings(rings);
  const pos = indexed.getAttribute("position") as THREE.BufferAttribute;
  const nrm = indexed.getAttribute("normal") as THREE.BufferAttribute;
  const index = indexed.getIndex();
  if (!index) throw new Error("hull loft missing attributes");
  const n = rings[0]!.loop.length;
  const bodyVerts = rings.length * n;
  const paint: number[] = [];
  const carbon: number[] = [];
  const glass: number[] = [];
  const vertZone = (vi: number) => {
    if (vi === bodyVerts) return "nose";
    if (vi > bodyVerts) return "tail";
    return rings[Math.floor(vi / n)]!.zone;
  };
  const vertSill = (vi: number) => (vi >= bodyVerts ? 99 : rings[Math.floor(vi / n)]!.sill);
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i);
    const b = index.getX(i + 1);
    const c = index.getX(i + 2);
    const y = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3;
    const zones = [vertZone(a), vertZone(b), vertZone(c)];
    const glassVotes = zones.filter((z) => z === "glassF" || z === "roof" || z === "glassR").length;
    const sill = (vertSill(a) + vertSill(b) + vertSill(c)) / 3;
    const bucket =
      a === bodyVerts || b === bodyVerts || c === bodyVerts
        ? paint
        : a > bodyVerts || b > bodyVerts || c > bodyVerts
          ? carbon
          : glassVotes >= 2 && y > sill
            ? glass
            : y >= 0.46
              ? paint
              : carbon;
    bucket.push(a, b, c);
  }
  const paintG = takeVerts(pos, nrm, paint);
  const carbonG = takeVerts(pos, nrm, carbon);
  const glassG = takeVerts(pos, nrm, glass.length >= 3 ? glass : paint.slice(0, 3));
  indexed.dispose();
  return { paint: paintG, carbon: carbonG, glass: glassG };
}

function widest(rings: Ring[], sign: number): Ring {
  let best = rings[0]!;
  for (const r of rings) {
    if (sign < 0 && r.z > -0.35) continue;
    if (sign > 0 && r.z < 0.35) continue;
    if (r.w > best.w) best = r;
  }
  return best;
}

function mergeScaled(parts: THREE.BufferGeometry[], sx: number, sy: number, sz: number): THREE.BufferGeometry {
  const scaled = mergeGeometries(parts, false);
  if (!scaled) throw new Error("car geometry merge failed");
  scaled.scale(sx, sy, sz);
  for (const g of parts) g.dispose();
  return scaled;
}

function finishPaint(hex: number): THREE.Color {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(0.66, Math.max(0.46, hsl.s + 0.16)), Math.min(0.34, Math.max(0.22, hsl.l + 0.1)));
  return c;
}

function paintOf(role: string): { body: number; accent: number; hero: boolean } {
  if (role === "vex") return { body: 0x3a1224, accent: 0xff3dce, hero: false };
  if (role === "ion") return { body: 0x221636, accent: 0xc084ff, hero: false };
  if (role === "nyx") return { body: 0x16140f, accent: 0xffb020, hero: false };
  return { body: 0x123844, accent: 0x2ee6ff, hero: true };
}

function roleFromColor(color: number): string {
  if (color === 0xff3dce) return "vex";
  if (color === 0xb26bff) return "ion";
  if (color === 0xffb020) return "nyx";
  return "player";
}

function raceNumberFor(role: string): string {
  if (role === "vex") return "13";
  if (role === "ion") return "44";
  if (role === "nyx") return "08";
  return "27";
}

function numberTexture(role: string, accent: number): THREE.CanvasTexture {
  return canvasTex((g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = "rgba(5, 8, 13, 0.88)";
    g.beginPath();
    g.roundRect(8, 18, w - 16, h - 36, 14);
    g.fill();
    g.strokeStyle = `#${accent.toString(16).padStart(6, "0")}`;
    g.lineWidth = 6;
    g.stroke();
    g.fillStyle = "#f8fbff";
    g.font = "900 70px Arial Narrow, Arial, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(raceNumberFor(role), w / 2, h / 2 + 2);
  }, 128, 80);
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

export function createCarView(color: number, style: BodyStyle = VECTOR.body, rival = false): CarView {
  const role = rival ? roleFromColor(color) : "player";
  const rivalLook = paintOf(role);
  const kind = silhouetteOf(style);
  const look = rival
    ? { body: rivalLook.body, accent: rivalLook.accent, glass: 0x1a222c, hero: false }
    : kind === "sharp"
      ? { body: 0x1a1024, accent: 0xff3bd6, glass: 0xe4c6ff, hero: true }
      : { body: style.paint, accent: style.accent, glass: style.glass, hero: true };
  const rings = sampleHull(kind);
  const front = widest(rings, 1);
  const rear = widest(rings, -1);
  const sx = style.body[0];
  const sy = 0.88 + (style.body[1] - 1) * 0.4;
  const sz = style.body[2];
  const root = new THREE.Group();
  const chassis = new THREE.Group();
  chassis.name = "chassis";
  root.add(chassis);
  const paint = new THREE.MeshPhysicalMaterial({
    color: finishPaint(look.body),
    roughness: 0.32,
    metalness: 0.18,
    clearcoat: 0.55,
    clearcoatRoughness: 0.22,
    envMapIntensity: 0.24,
    emissive: look.accent,
    emissiveIntensity: 0.03,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x101216, roughness: 0.62, metalness: 0.4 });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.55, metalness: 0.55 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(look.glass).lerp(new THREE.Color(0x05070c), 0.82),
    roughness: 0.05,
    metalness: 0.06,
    transparent: true,
    opacity: 0.92,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    envMapIntensity: 0.38,
    depthWrite: true,
  });
  const brakeMat = new THREE.MeshStandardMaterial({
    color: 0x3a1018,
    emissive: 0xff2438,
    emissiveIntensity: 0.4,
    roughness: 0.35,
  });
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xf4f7fb,
    emissive: 0xf7fbff,
    emissiveIntensity: look.hero ? 1.2 : 0.75,
    roughness: 0.18,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0x101216,
    emissive: look.accent,
    emissiveIntensity: 0.45,
    roughness: 0.35,
    metalness: 0.25,
  });

  const tip = rings[rings.length - 1]!;
  const tail = rings[0]!;
  const deck = rings.find((r) => r.zone === "deck") ?? rear;
  const hull = splitHull(rings);
  const carbonParts: THREE.BufferGeometry[] = [hull.carbon];
  const splitW = kind === "wide" ? 1.9 : kind === "sharp" ? 1.72 : kind === "long" ? 1.48 : 1.62;
  carbonParts.push(boxAt(front.w * splitW, 0.028, 0.34, 0, 0.3, tip.z - 0.12));
  carbonParts.push(boxAt(front.w * 0.38, 0.08, 0.12, 0, 0.4, tip.z - 0.18));
  const skirtZ = (front.z + rear.z) * 0.5;
  for (const side of [-1, 1] as const) {
    carbonParts.push(boxAt(0.055, 0.045, Math.abs(front.z - rear.z) * 0.62, side * (front.w * 0.9), 0.33, skirtZ));
  }
  if (kind === "sharp" || kind === "wide") {
    carbonParts.push(boxAt(0.14, 0.02, 0.16, front.w * 0.72, 0.33, front.z + 0.08));
    carbonParts.push(boxAt(0.14, 0.02, 0.16, -front.w * 0.72, 0.33, front.z + 0.08));
  }
  if (kind === "sharp") {
    carbonParts.push(boxAt(0.1, 0.03, 0.22, 0.16, 0.56, front.z + 0.05));
    carbonParts.push(boxAt(0.1, 0.03, 0.22, -0.16, 0.56, front.z + 0.05));
  }
  const cockpit = boxAt(0.62, 0.16, 1.2, 0, 0.82, -0.2);
  const shell = new THREE.Mesh(mergeScaled([hull.paint], sx, sy, sz), paint);
  const trim = new THREE.Mesh(mergeScaled(carbonParts, sx, sy, sz), carbon);
  const tubDark = new THREE.Mesh(mergeScaled([cockpit], sx, sy, sz), dark);
  const cabin = new THREE.Mesh(mergeScaled([hull.glass], sx, sy, sz), glass);
  shell.name = "body";
  trim.name = "aero";
  cabin.name = "cabin";

  const roofRing = rings.reduce((a, r) => (r.y > a.y ? r : a), rings[0]!);
  const roofY = roofRing.y * sy;
  const axleZ = rear.z * sz;
  const wingSpan = rear.w * sx * 2 * (0.84 + 0.12 * Math.min(1.15, Math.max(0, style.wing[0] - 0.85)));
  const wingChord = 0.3 + 0.11 * Math.min(style.wing[2], 1.5);
  const wingY = roofY + Math.max(-0.05, (style.wing[1] - 1.02) * 0.26);
  const wingZ = axleZ - 0.36 * sz - Math.max(0, style.wingZ - 1.55) * 0.18;
  const wingRig = new THREE.Group();
  wingRig.position.set(0, wingY, wingZ);
  wingRig.rotation.x = -0.14;
  const wingMat = carbon.clone();
  wingMat.side = THREE.DoubleSide;
  const plane = new THREE.Mesh(wingPlane(wingSpan, wingChord, 0.045 + 0.012 * style.wing[1]), wingMat);
  const flap = new THREE.Mesh(wingPlane(wingSpan * 0.92, wingChord * 0.42, 0.028), wingMat);
  flap.position.set(0, -0.045, -wingChord * 0.16);
  wingRig.add(plane, flap);
  const epH = 0.16 + 0.1 * style.wing[1];
  const epGeo = new THREE.BoxGeometry(0.016, epH, wingChord * 0.86);
  for (const side of [-1, 1] as const) {
    const ep = new THREE.Mesh(epGeo, wingMat);
    ep.position.set(side * (wingSpan * 0.5), -epH * 0.08, -wingChord * 0.04);
    const pin = new THREE.Mesh(geos.lens, accentMat);
    pin.scale.set(0.01, epH * 0.55, 0.012);
    pin.position.set(side * (wingSpan * 0.5), 0.01, wingChord * 0.28);
    wingRig.add(ep, pin);
  }
  if (kind === "sharp") {
    const upper = new THREE.Mesh(wingPlane(wingSpan * 0.68, wingChord * 0.36, 0.022), wingMat);
    upper.position.set(0, 0.06, wingChord * 0.02);
    wingRig.add(upper);
  }
  const pylonH = Math.max(0.2, wingY - deck.y * sy - 0.02);
  const pylonGeo = new THREE.BoxGeometry(0.028, pylonH, 0.035);
  for (const side of [-1, 1] as const) {
    const pylon = new THREE.Mesh(pylonGeo, carbon);
    pylon.position.set(side * rear.w * 0.28 * sx, deck.y * sy + pylonH * 0.45, wingZ + 0.02);
    chassis.add(pylon);
  }

  const lipW = front.w * (kind === "wide" ? 1.85 : kind === "sharp" ? 1.7 : kind === "long" ? 1.42 : 1.58) * sx;
  const lip = new THREE.Mesh(geos.lens, accentMat);
  lip.scale.set(lipW, 0.012, 0.028);
  lip.position.set(0, 0.3, (tip.z + 0.01) * sz);
  const stripe = new THREE.Mesh(geos.lens, accentMat);
  stripe.scale.set(0.028 * sx, 0.008, 0.7 * sz);
  stripe.position.set(0, 0.55 * sy, 1.15 * sz);

  const diffW = rear.w * sx * (kind === "wide" ? 1.2 : kind === "sharp" ? 1.08 : kind === "long" ? 0.86 : 0.98);
  const fins = kind === "sharp" ? 5 : kind === "long" ? 3 : 4;
  const diffuser = new THREE.Group();
  diffuser.position.set(0, 0.3, tail.z * sz + 0.08);
  const blade = new THREE.Mesh(geos.lens, carbon);
  blade.scale.set(diffW, 0.03, 0.36);
  blade.position.set(0, 0.01, 0.06);
  blade.rotation.x = 0.2;
  diffuser.add(blade);
  for (let i = 0; i < fins; i++) {
    const t = (i / (fins - 1)) * 2 - 1;
    const fin = new THREE.Mesh(geos.lens, dark);
    fin.scale.set(0.016, 0.055, 0.28);
    fin.position.set(t * diffW * 0.36, 0.035, 0.05);
    fin.rotation.x = 0.2;
    diffuser.add(fin);
  }

  const glowMat = new THREE.MeshBasicMaterial({
    color: look.accent,
    transparent: true,
    opacity: look.hero ? 0.08 : 0.035,
  });
  const glow = new THREE.Mesh(geos.glow, glowMat);
  glow.position.set(0, 0.08, 0);
  glow.scale.set(sx * front.w, 1, sz * 1.35);
  const length = (tip.z - tail.z) * sz;
  const contact = new THREE.Mesh(
    geos.contact,
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }),
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.046;
  contact.scale.set((front.w * 1.55 * sx) / 2.7, 1, length / 3.2);
  chassis.add(shell, trim, tubDark, cabin, wingRig, lip, stripe, diffuser, glow);
  root.add(contact);

  const exhaustMat = new THREE.MeshStandardMaterial({ color: 0x1c2128, metalness: 0.78, roughness: 0.32 });
  const exhaustRim = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.84, roughness: 0.26 });
  const exhaustXs = kind === "sharp" ? [-0.36, -0.15, 0.15, 0.36] : kind === "wide" ? [-0.3, 0.3] : [-0.22, 0.22];
  for (const x of exhaustXs) {
    const pipe = new THREE.Mesh(geos.bell, exhaustMat);
    pipe.position.set(x * sx, 0.36 * sy, tail.z * sz + 0.02);
    const bore = new THREE.Mesh(geos.bore, dark);
    bore.position.set(0, 0, -0.05);
    const ring = new THREE.Mesh(geos.outlet, exhaustRim);
    ring.position.set(0, 0, -0.062);
    pipe.add(bore, ring);
    chassis.add(pipe);
  }

  const mirrorZ = ((rings.find((r) => r.zone === "glassF")?.z ?? 0.3) + 0.08) * sz;
  for (const side of [-1, 1] as const) {
    const stalk = new THREE.Mesh(geos.lens, carbon);
    stalk.scale.set(0.07, 0.016, 0.02);
    stalk.position.set(side * front.w * 0.62 * sx, 0.82 * sy, mirrorZ);
    const head = new THREE.Mesh(geos.lens, carbon);
    head.scale.set(0.09, 0.032, 0.045);
    head.position.set(side * (front.w * 0.62 * sx + 0.07), 0.84 * sy, mirrorZ + 0.01);
    const glassBit = new THREE.Mesh(geos.lens, dark);
    glassBit.scale.set(0.055, 0.02, 0.008);
    glassBit.position.set(side * (front.w * 0.62 * sx + 0.07), 0.84 * sy, mirrorZ + 0.03);
    chassis.add(stalk, head, glassBit);
    const mouthW = kind === "long" ? 0.22 : kind === "sharp" ? 0.36 : 0.28;
    const mouthH = kind === "sharp" ? 0.14 : kind === "wide" ? 0.12 : 0.1;
    const intakeZ = (rear.z + 0.42) * sz;
    const intakeX = side * rear.w * 0.9 * sx;
    const mouth = new THREE.Mesh(geos.lens, dark);
    mouth.scale.set(0.045, mouthH, mouthW);
    mouth.position.set(intakeX, 0.56 * sy, intakeZ);
    const frame = new THREE.Mesh(geos.lens, carbon);
    frame.scale.set(0.02, mouthH + 0.03, mouthW + 0.04);
    frame.position.set(intakeX + side * 0.02, 0.56 * sy, intakeZ);
    chassis.add(mouth, frame);
    const belt = new THREE.Mesh(geos.lens, dark);
    belt.scale.set(0.012, 0.008, Math.abs(front.z - rear.z) * 0.42 * sz);
    belt.position.set(side * front.w * 0.93 * sx, 0.72 * sy, (front.z * 0.2 + rear.z * 0.15) * sz);
    chassis.add(belt);
  }

  const wheels: THREE.Object3D[] = [];
  const frontPivots: THREE.Object3D[] = [];
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x121418, roughness: 0.96, metalness: 0.02 });
  const rimMat = new THREE.MeshStandardMaterial({
    color: kind === "sharp" ? 0xb7bec6 : kind === "long" ? 0xf4f7fb : kind === "wide" ? 0xe4d2b4 : 0xe6edf4,
    roughness: 0.42,
    metalness: 0.42,
  });
  const discMat = new THREE.MeshStandardMaterial({ color: 0x1c2126, roughness: 0.58, metalness: 0.55 });
  const caliperMat = new THREE.MeshStandardMaterial({
    color: kind === "wide" ? 0xd7e2ee : kind === "long" ? 0xf2f6fa : look.accent,
    roughness: 0.4,
    metalness: 0.32,
  });
  const wellMat = new THREE.MeshStandardMaterial({ color: 0x0c0e12, roughness: 0.9, metalness: 0.1, side: THREE.DoubleSide });
  const tireGeo = kind === "wide" ? geos.tireWide : kind === "long" ? geos.tireSlim : geos.tire;
  const rimGeo = kind === "sharp" ? geos.rimVanta : kind === "long" ? geos.rimSurge : kind === "wide" ? geos.rimAegis : geos.rimVector;
  const fx = Math.max(0.46, front.w * sx - 0.22);
  const rearX = Math.max(0.46, rear.w * sx - 0.22);
  const zf = front.z * sz;
  const zr = rear.z * sz;
  const spots: Array<[number, number, boolean]> = [
    [fx, zf, true],
    [-fx, zf, true],
    [rearX, zr, false],
    [-rearX, zr, false],
  ];
  const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false });
  for (const [x, z, steered] of spots) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.392, z);
    const spin = new THREE.Group();
    const tire = new THREE.Mesh(tireGeo, wheelMat);
    const rim = new THREE.Mesh(rimGeo, rimMat);
    const disc = new THREE.Mesh(geos.disc, discMat);
    if (kind === "wide") disc.scale.set(1.05, 1.15, 1.15);
    spin.add(tire, disc, rim);
    const reach = Math.max(0.35, Math.abs(x) - 0.2);
    const arm = new THREE.Mesh(geos.arm, carbon);
    arm.scale.set(reach / 0.72, 1, 1);
    arm.position.set(-Math.sign(x) * reach * 0.5, 0.06, 0);
    const caliper = new THREE.Mesh(geos.caliper, caliperMat);
    caliper.position.set(Math.sign(x) * 0.02, 0.16, 0.02);
    if (kind === "wide") caliper.scale.set(1.2, 1.35, 1.25);
    const well = new THREE.Mesh(geos.well, wellMat);
    well.position.set(x - Math.sign(x) * 0.02, 0.46, z);
    const arch = new THREE.Mesh(geos.arch, carbon);
    arch.position.set(x, 0.5, z);
    const blob = new THREE.Mesh(geos.contact, blobMat);
    blob.rotation.x = -Math.PI / 2;
    blob.position.set(x, 0.05, z);
    blob.scale.set(0.2, 0.2, 0.14);
    pivot.add(spin, arm, caliper);
    chassis.add(well, arch);
    root.add(pivot, blob);
    wheels.push(spin);
    if (steered) frontPivots.push(pivot);
  }

  const lampZ = (tip.z * 0.58 + front.z * 0.42) * sz;
  const lampX = Math.max(0.28, front.w * 0.46 * sx);
  const lampY = 0.46 * sy;
  const lampW = kind === "wide" ? 0.3 : kind === "sharp" ? 0.2 : 0.24;
  const tailLampZ = tail.z * sz - 0.012;
  const tailW = kind === "wide" ? 0.36 : kind === "sharp" ? 0.28 : 0.3;
  for (const side of [-1, 1] as const) {
    const bezel = new THREE.Mesh(geos.bezel, dark);
    bezel.scale.set(lampW, 0.048, 0.03);
    bezel.position.set(side * lampX, lampY, lampZ - 0.01);
    bezel.rotation.z = side * -0.06;
    const lamp = new THREE.Mesh(geos.lens, lampMat);
    lamp.scale.set(lampW * 0.72, 0.01, 0.01);
    lamp.position.set(side * lampX, lampY, lampZ + 0.006);
    lamp.rotation.z = side * -0.06;
    chassis.add(bezel, lamp);
    const house = new THREE.Mesh(geos.bezel, dark);
    house.scale.set(tailW, 0.04, 0.022);
    house.position.set(side * rear.w * 0.4 * sx, 0.56 * sy, tailLampZ);
    house.rotation.y = side * 0.18;
    const led = new THREE.Mesh(geos.tailLens, brakeMat);
    led.scale.set(tailW * 0.78, 0.01, 0.01);
    led.position.set(side * rear.w * 0.4 * sx, 0.56 * sy, tailLampZ - 0.006);
    led.rotation.y = side * 0.18;
    chassis.add(house, led);
  }
  const brakeBar = new THREE.Mesh(geos.tailLens, brakeMat);
  brakeBar.scale.set(rear.w * 0.22 * sx, 0.008, 0.01);
  brakeBar.position.set(0, 0.7 * sy, tailLampZ - 0.004);
  chassis.add(brakeBar);

  // A small race number and side number plates make the cars read as entries
  // in a real grid instead of anonymous neon shapes at race distance.
  const numberMap = numberTexture(role, look.accent);
  const numberMat = new THREE.MeshBasicMaterial({ map: numberMap, transparent: true, toneMapped: false });
  const rearNumber = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.44), numberMat);
  rearNumber.position.set(0, 0.62 * sy, tailLampZ - 0.02);
  rearNumber.rotation.y = Math.PI;
  chassis.add(rearNumber);
  for (const side of [-1, 1] as const) {
    const sideNumber = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.34), numberMat.clone());
    sideNumber.position.set(side * (front.w * 0.96 * sx), 0.64 * sy, -0.34 * sz);
    sideNumber.rotation.y = side * Math.PI * 0.5;
    chassis.add(sideNumber);
  }

  const hoodVent = new THREE.Mesh(geos.lens, dark);
  hoodVent.scale.set(kind === "sharp" ? 0.22 : 0.12, 0.012, kind === "long" ? 0.16 : 0.28);
  hoodVent.position.set(0, 0.52 * sy, (front.z + 0.15) * sz);
  chassis.add(hoodVent);

  const headLight = new THREE.SpotLight(0xfff4e4, 3.4, 36, 0.48, 0.65, 1.4);
  headLight.position.set(0, lampY, lampZ - 0.15);
  headLight.castShadow = false;
  const target = new THREE.Object3D();
  target.position.set(0, 0.15, 16);
  headLight.target = target;
  chassis.add(headLight, target);

  const tailLight = new THREE.PointLight(0xff1838, 0.08, 7, 2);
  tailLight.position.set(0, 0.66 * sy, tailLampZ - 0.16);
  chassis.add(tailLight);

  const boost = new THREE.Group();
  const flameA = new THREE.MeshBasicMaterial({ color: look.accent, transparent: true, opacity: 0.85 });
  const flameB = new THREE.MeshBasicMaterial({ color: 0xfff6ea, transparent: true, opacity: 0.95 });
  const flameZ = tail.z * sz - 0.1;
  const pair = exhaustXs.length > 2 ? [exhaustXs[1]!, exhaustXs[2]!] : [exhaustXs[0]!, exhaustXs[1]!];
  const f1 = new THREE.Mesh(geos.boost, flameA);
  f1.position.set(pair[0]! * sx, 0.36 * sy, flameZ);
  const f2 = new THREE.Mesh(geos.boost, flameB);
  f2.position.set(pair[1]! * sx, 0.36 * sy, flameZ);
  const f3 = new THREE.Mesh(geos.boost, flameA);
  f3.position.set((pair[0]! + pair[1]!) * 0.5 * sx, 0.35 * sy, flameZ - 0.14);
  f3.scale.set(0.65, 0.65, 1.15);
  boost.add(f1, f2, f3);
  boost.visible = false;
  chassis.add(boost);

  const boostLight = new THREE.PointLight(look.accent, 0, 6, 2);
  boostLight.position.set(0, 0.34 * sy, flameZ - 0.22);
  chassis.add(boostLight);

  return {
    root,
    chassis,
    wheels,
    frontPivots,
    brakeMat,
    paint,
    boost,
    glow,
    headLight,
    tailLight,
    boostLight,
    hero: look.hero,
  };
}

function ribbon(samples: Sample[], place: (s: Sample) => number[]): THREE.BufferGeometry {
	const n = samples.length;
	const positions = new Float32Array(n * 2 * 3);
	const indices = [];
	for (let i = 0; i < n; i++) positions.set(place(samples[i]), i * 6);
	for (let i = 0; i < n; i++) {
		const i2 = (i + 1) % n;
		const a = i * 2;
		const b = a + 1;
		const c = i2 * 2;
		const d = c + 1;
		indices.push(a, c, b, b, c, d);
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
	geo.setIndex(indices);
	geo.computeVertexNormals();
	return geo;
}
function paintAlong(geo: THREE.BufferGeometry, samples: Sample[], meters: number): void {
	const uvs = new Float32Array(samples.length * 4);
	for (let i = 0; i < samples.length; i++) {
		const v = samples[i].dist / meters;
		uvs[i * 4] = 0;
		uvs[i * 4 + 1] = v;
		uvs[i * 4 + 2] = 1;
		uvs[i * 4 + 3] = v;
	}
	geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
}
function canvasTex(draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number): THREE.CanvasTexture {
	const c = document.createElement("canvas");
	c.width = w;
	c.height = h;
	const g = c.getContext("2d");
	if (g) draw(g, w, h);
	const tex = new THREE.CanvasTexture(c);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.wrapS = THREE.RepeatWrapping;
	tex.wrapT = THREE.RepeatWrapping;
	tex.anisotropy = 4;
	return tex;
}
function dataTex(draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number): THREE.CanvasTexture {
	const tex = canvasTex(draw, w, h);
	tex.colorSpace = THREE.LinearSRGBColorSpace;
	return tex;
}
function asphaltTextures(kind: string): { map: THREE.CanvasTexture; rough: THREE.CanvasTexture } {
	const base = kind === "yard" ? [62, 56, 48] : kind === "coast" ? [64, 70, 76] : kind === "core" ? [58, 54, 56] : [60, 62, 66];
	const line = kind === "yard" ? "#f0e2c4" : kind === "core" ? "#f4f6f8" : "#f7f8fb";
	return {
		map: canvasTex((g, w, h) => {
			g.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
			g.fillRect(0, 0, w, h);
			for (let i = 0; i < 4200; i++) {
				const n = (Math.random() - 0.5) * 22;
				g.fillStyle = `rgba(${base[0] + n},${base[1] + n},${base[2] + n},0.45)`;
				g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
			}
			g.fillStyle = "rgba(40,36,32,0.16)";
			g.fillRect(w * 0.22, 0, w * 0.08, h);
			g.fillRect(w * 0.7, 0, w * 0.08, h);
			for (let i = 0; i < 6; i++) {
				g.fillStyle = `rgba(${base[0] + 18},${base[1] + 16},${base[2] + 14},0.35)`;
				g.fillRect(w * 0.15 + Math.random() * w * 0.5, Math.random() * h, 40 + Math.random() * 70, 16 + Math.random() * 28);
			}
			g.strokeStyle = "rgba(20,18,16,0.22)";
			g.lineWidth = 1;
			for (let y = 0; y < h; y += 86) {
				g.beginPath();
				g.moveTo(0, y);
				g.lineTo(w, y + 2);
				g.stroke();
			}
			g.fillStyle = line;
			g.globalAlpha = 0.85;
			g.fillRect(w * 0.055, 0, 4, h);
			g.fillRect(w * 0.92, 0, 4, h);
			g.globalAlpha = 1;
			g.fillStyle = kind === "yard" ? "#f3ead8" : "#f4f1e8";
			for (let y = 10; y < h; y += 46) g.fillRect(w * 0.5 - 2.5, y, 5, 16);
		}, 512, 512),
		rough: dataTex((g, w, h) => {
			g.fillStyle = "#c8c8c8";
			g.fillRect(0, 0, w, h);
			for (let i = 0; i < 2500; i++) {
				const v = 140 + Math.random() * 90;
				g.fillStyle = `rgb(${v},${v},${v})`;
				g.fillRect(Math.random() * w, Math.random() * h, 3, 3);
			}
			g.fillStyle = "#8a8a8a";
			g.fillRect(w * .2, 0, w * .08, h);
			g.fillRect(w * .72, 0, w * .08, h);
		}, 256, 256)
	};
}
function _facadeTexture(warm: boolean): THREE.CanvasTexture {
	return canvasTex((g, w, h) => {
		g.fillStyle = warm ? "#2a241e" : "#1a222c";
		g.fillRect(0, 0, w, h);
		const litA = warm ? "#ffb060" : "#d7e4f2";
		const litB = warm ? "#ffd7a0" : "#8ecfff";
		for (let y = 8; y < h; y += 18) for (let x = 8; x < w; x += 16) {
			const roll = Math.random();
			if (roll < .45) continue;
			g.fillStyle = roll > .82 ? litB : litA;
			g.globalAlpha = roll > .7 ? .95 : .35;
			g.fillRect(x, y, 7, 10);
		}
		g.globalAlpha = 1;
	}, 256, 256);
}
function terrainTexture(kind: string): THREE.CanvasTexture {
	const base = kind === "coast" ? [
		14,
		36,
		48
	] : kind === "yard" ? [
		28,
		24,
		20
	] : kind === "core" ? [
		22,
		16,
		18
	] : [
		18,
		20,
		24
	];
	return canvasTex((g, w, h) => {
		g.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
		g.fillRect(0, 0, w, h);
		for (let i = 0; i < 1800; i++) {
			const n = (Math.random() - .5) * 18;
			g.fillStyle = `rgba(${base[0] + n},${base[1] + n},${base[2] + n},0.7)`;
			g.fillRect(Math.random() * w, Math.random() * h, 4, 3);
		}
	}, 256, 256);
}
function skyDome(top: number, horizon: number, kind: string): THREE.Group {
	const c = document.createElement("canvas");
	c.width = 512;
	c.height = 256;
	const g = c.getContext("2d");
	const up = new THREE.Color(top);
	const mid = new THREE.Color(horizon);
	const glow = kind === "yard" ? "#6a3a22" : kind === "coast" ? "#1d5a86" : kind === "core" ? "#5a2030" : "#1a6288";
	const group = new THREE.Group();
	if (g) {
		const grad = g.createLinearGradient(0, 0, 0, 256);
		const zenith = up.clone().multiplyScalar(kind === "coast" ? 1.45 : kind === "yard" ? 1.15 : kind === "core" ? 1.25 : 1.2);
		const band = mid.clone().multiplyScalar(kind === "core" ? 1.35 : 1.25);
		grad.addColorStop(0, `#${zenith.getHexString()}`);
		grad.addColorStop(0.4, `#${band.getHexString()}`);
		grad.addColorStop(0.68, glow);
		grad.addColorStop(0.84, `#${mid.clone().multiplyScalar(kind === "yard" ? 1.05 : 1.15).getHexString()}`);
		grad.addColorStop(1, `#${mid.clone().multiplyScalar(0.72).getHexString()}`);
		g.fillStyle = grad;
		g.fillRect(0, 0, 512, 256);
		g.fillStyle = "rgba(255,255,255,0.85)";
		for (let i = 0; i < 80; i++) {
			const x = (i * 97) % 512;
			const y = (i * 53) % 110;
			g.globalAlpha = 0.25 + (i % 5) * 0.12;
			g.fillRect(x, y, i % 7 === 0 ? 2 : 1, i % 7 === 0 ? 2 : 1);
		}
		g.globalAlpha = 1;
		const cloud = kind === "core" ? "rgba(120,70,78,0.34)" : kind === "yard" ? "rgba(140,90,60,0.32)" : "rgba(214,226,236,0.2)";
		const puffs: Array<[number, number, number]> = [[70, 168, 120], [240, 150, 90], [400, 176, 140], [140, 92, 70], [340, 78, 56]];
		for (const [x, y, rad] of puffs) {
			const shade = g.createRadialGradient(x, y, rad * 0.15, x, y, rad);
			shade.addColorStop(0, cloud);
			shade.addColorStop(1, "rgba(0,0,0,0)");
			g.fillStyle = shade;
			g.fillRect(x - rad, y - rad * 0.45, rad * 2, rad * 0.9);
		}
	}
	const tex = new THREE.CanvasTexture(c);
	tex.colorSpace = THREE.SRGBColorSpace;
	const dome = new THREE.Mesh(new THREE.SphereGeometry(2000, 32, 20), new THREE.MeshBasicMaterial({
		map: tex,
		side: THREE.BackSide,
		depthWrite: false,
		fog: false,
	}));
	group.add(dome);
	const moonColor = kind === "yard" ? 0xffd2b0 : kind === "core" ? 0xf0d0d8 : 0xe7eef8;
	const moon = new THREE.Mesh(new THREE.SphereGeometry(16, 18, 14), new THREE.MeshBasicMaterial({ color: moonColor, fog: false }));
	moon.position.set(kind === "coast" ? -380 : 460, 280, kind === "yard" ? 220 : -260);
	const halo = new THREE.Mesh(new THREE.SphereGeometry(34, 16, 12), new THREE.MeshBasicMaterial({
		color: moonColor,
		transparent: true,
		opacity: 0.12,
		depthWrite: false,
		fog: false,
	}));
	halo.position.copy(moon.position);
	group.add(moon, halo);
	return group;
}
function barrierTexture(): THREE.CanvasTexture {
	return canvasTex((g, w, h) => {
		g.fillStyle = "#b7c0c8";
		g.fillRect(0, 0, w, h);
		g.fillStyle = "#8d98a2";
		g.fillRect(0, h * 0.62, w, h * 0.38);
		for (let i = 0; i < 40; i++) {
			const v = 90 + Math.random() * 40;
			g.fillStyle = `rgba(${v},${v},${v},0.25)`;
			g.fillRect(Math.random() * w, Math.random() * h, 2, 3);
		}
		g.fillStyle = "rgba(16,18,22,0.45)";
		g.fillRect(0, h - 5, w, 5);
		g.fillStyle = "rgba(255,255,255,0.28)";
		g.fillRect(0, 0, w, 3);
	}, 32, 64);
}
function curbTexture(light: string, dark: string): THREE.CanvasTexture {
	return canvasTex((g, w, h) => {
		for (let y = 0; y < h; y += 16) {
			g.fillStyle = y % 32 === 0 ? light : dark;
			g.fillRect(0, y, w, 16);
		}
	}, 32, 128);
}
function signTexture(text: string, color: string): THREE.CanvasTexture {
	const tex = canvasTex((g, w, h) => {
		g.fillStyle = "rgba(10,12,16,0.92)";
		g.fillRect(0, 0, w, h);
		g.strokeStyle = color;
		g.lineWidth = 8;
		g.strokeRect(10, 10, w - 20, h - 20);
		g.fillStyle = "#f4f7fb";
		g.font = "700 58px sans-serif";
		g.textAlign = "center";
		g.textBaseline = "middle";
		g.fillText(text, w / 2, h / 2 + 2);
	}, 512, 128);
	tex.wrapS = THREE.ClampToEdgeWrapping;
	tex.wrapT = THREE.ClampToEdgeWrapping;
	return tex;
}
function trackBasis(tx: number, tz: number, rx: number, rz: number): THREE.Matrix4 {
	return new THREE.Matrix4().makeBasis(new THREE.Vector3(-rx, 0, -rz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(tx, 0, tz));
}
function basis(group: THREE.Object3D, s: Sample): void {
	group.quaternion.setFromRotationMatrix(trackBasis(s.tx, s.tz, s.rx, s.rz));
	group.position.set(s.x, s.y, s.z);
}
function addGantry(parent: THREE.Object3D, s: Sample, text: string, color: string): void {
	const group = new THREE.Group();
	basis(group, s);
	const h = s.width * .5 + 1.6;
	const steel = new THREE.MeshStandardMaterial({
		color: 1712176,
		metalness: .72,
		roughness: .28
	});
	const post = new THREE.BoxGeometry(.42, 6.4, .42);
	const left = new THREE.Mesh(post, steel);
	left.position.set(-h, 3.2, 0);
	const right = new THREE.Mesh(post, steel);
	right.position.set(h, 3.2, 0);
	const beam = new THREE.Mesh(new THREE.BoxGeometry(h * 2.05, .32, .5), steel);
	beam.position.y = 6.35;
	const board = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(14, h * 1.5), 2.15), new THREE.MeshBasicMaterial({
		map: signTexture(text, color),
		transparent: true
	}));
	board.position.set(0, 5.55, .05);
	board.rotation.y = Math.PI;
	const lip = new THREE.Mesh(new THREE.BoxGeometry(h * 2.05, .08, .12), new THREE.MeshStandardMaterial({
		color: 1185306,
		emissive: color,
		emissiveIntensity: .4,
		metalness: .4,
		roughness: .35
	}));
	lip.position.y = 6.55;
	const chord = new THREE.Mesh(new THREE.BoxGeometry(h * 2.05, .1, .22), steel);
	chord.position.y = 5.9;
	const lampMat = new THREE.MeshBasicMaterial({ color });
	const housings = new THREE.Group();
	for (let i = -1; i <= 1; i++) {
		const x = i * Math.min(h * .42, 3.2);
		const housing = new THREE.Mesh(new THREE.BoxGeometry(.7, .1, .32), steel);
		housing.position.set(x, 6.08, .12);
		const bulb = new THREE.Mesh(new THREE.BoxGeometry(.42, .035, .14), lampMat);
		bulb.position.set(x, 6, .12);
		housings.add(housing, bulb);
	}
	const footGeo = new THREE.BoxGeometry(.72, .1, .72);
	const footL = new THREE.Mesh(footGeo, steel);
	footL.position.set(-h, .05, 0);
	const footR = new THREE.Mesh(footGeo, steel);
	footR.position.set(h, .05, 0);
	group.add(left, right, beam, board, lip, chord, housings, footL, footR);
	parent.add(group);
}
function addArch(parent: THREE.Object3D, gate: Gate, color: number, height: number): void {
	const mat = new THREE.MeshStandardMaterial({
		color: 1316894,
		emissive: color,
		emissiveIntensity: .55,
		metalness: .5,
		roughness: .32
	});
	const steel = new THREE.MeshStandardMaterial({
		color: 1316896,
		metalness: .6,
		roughness: .3
	});
	const group = new THREE.Group();
	group.position.set(gate.x, gate.y, gate.z);
	group.quaternion.setFromRotationMatrix(trackBasis(gate.tx, gate.tz, gate.rx, gate.rz));
	const span = gate.half * 2 + 2.4;
	const postGeo = new THREE.BoxGeometry(.4, height, .4);
	const left = new THREE.Mesh(postGeo, steel);
	left.position.set(-span / 2, height / 2, 0);
	const right = new THREE.Mesh(postGeo, steel);
	right.position.set(span / 2, height / 2, 0);
	const bar = new THREE.Mesh(new THREE.BoxGeometry(span, .28, .4), mat);
	bar.position.set(0, height, 0);
	group.add(left, right, bar);
	parent.add(group);
}
function _mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = a + 1831565813 | 0;
		let t = Math.imul(a ^ a >>> 15, 1 | a);
		t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}
export function buildScene(track: Track, carsIn: CarPaint[]): SceneBundle {
	const theme = themeFor(track.themeId);
	const scene = new THREE.Scene();
	scene.background = new THREE.Color(theme.sky);
	scene.fog = new THREE.FogExp2(theme.fog, theme.fogDensity);
	scene.userData.fogDensity = theme.fogDensity;
	scene.add(skyDome(theme.sky, theme.fog, theme.kind));
	scene.add(new THREE.HemisphereLight(theme.hemiSky, theme.hemiGround, theme.hemiStrength));
	const moon = new THREE.DirectionalLight(theme.moon, theme.moonIntensity);
	moon.position.set(120, 180, 40);
	const fill = new THREE.DirectionalLight(theme.fillLight, theme.fillStrength);
	fill.position.set(-80, 40, -30);
	scene.add(moon, fill);
	const asphalt = asphaltTextures(theme.kind);
	const roadMat = new THREE.MeshStandardMaterial({
		color: 16777215,
		map: asphalt.map,
		roughnessMap: asphalt.rough,
		roughness: .94,
		metalness: .02,
		emissive: theme.roadEmissive,
		emissiveIntensity: theme.roadGlow
	});
	const road = new THREE.Mesh(ribbon(track.samples, (s) => {
		const h = s.width * .5;
		return [
			s.x - s.rx * h,
			s.y + .03,
			s.z - s.rz * h,
			s.x + s.rx * h,
			s.y + .03,
			s.z + s.rz * h
		];
	}), roadMat);
	paintAlong(road.geometry, track.samples, 14);
	scene.add(road);
	const shellMat = roadMat.clone();
	shellMat.color = new THREE.Color(0x24262a);
	shellMat.side = THREE.DoubleSide;
	const deck = 0.14;
	const under = new THREE.Mesh(ribbon(track.samples, (s) => {
		const h = s.width * .5;
		return [
			s.x - s.rx * h,
			s.y + .03 - deck,
			s.z - s.rz * h,
			s.x + s.rx * h,
			s.y + .03 - deck,
			s.z + s.rz * h
		];
	}), shellMat);
	paintAlong(under.geometry, track.samples, 14);
	const roadEdge = (sign: number) => {
		const mesh = new THREE.Mesh(ribbon(track.samples, (s) => {
			const lat = s.width * .5 * sign;
			return [
				s.x + s.rx * lat,
				s.y + .03,
				s.z + s.rz * lat,
				s.x + s.rx * lat,
				s.y + .03 - deck,
				s.z + s.rz * lat
			];
		}), shellMat);
		paintAlong(mesh.geometry, track.samples, 14);
		return mesh;
	};
	scene.add(under, roadEdge(-1), roadEdge(1));
	const curbTint = theme.kind === "yard" ? [
		["#f4ead8", "#8a5a2e"],
		["#f4ead8", "#8a5a2e"]
	] : theme.kind === "coast" ? [
		["#f7fbff", "#2c5c80"],
		["#f7fbff", "#2c5c80"]
	] : theme.kind === "core" ? [
		["#f3f5f8", "#7a2e3c"],
		["#f3f5f8", "#2c5278"]
	] : [
		["#f7fbff", "#1a6d84"],
		["#f7fbff", "#6e3a58"]
	];
	const curbMatFor = (index: number) => new THREE.MeshStandardMaterial({
		map: curbTexture(curbTint[index][0], curbTint[index][1]),
		roughness: .74,
		metalness: .04,
		emissive: theme.curbEmissive,
		emissiveIntensity: Math.min(.04, theme.curbGlow)
	});
	const curb = (sign: number) => ribbon(track.samples, (s) => {
		const h = s.width * .5;
		const a = sign * (h - .92);
		const b = sign * (h - .08);
		return [
			s.x + s.rx * a,
			s.y + .16,
			s.z + s.rz * a,
			s.x + s.rx * b,
			s.y + .08,
			s.z + s.rz * b
		];
	});
	const curbFace = (sign: number) => ribbon(track.samples, (s) => {
		const lat = sign * (s.width * .5 - .92);
		return [
			s.x + s.rx * lat,
			s.y + .03,
			s.z + s.rz * lat,
			s.x + s.rx * lat,
			s.y + .16,
			s.z + s.rz * lat
		];
	});
	const curbL = new THREE.Mesh(curb(-1), curbMatFor(0));
	const curbR = new THREE.Mesh(curb(1), curbMatFor(1));
	const curbFaceL = new THREE.Mesh(curbFace(-1), curbMatFor(0));
	const curbFaceR = new THREE.Mesh(curbFace(1), curbMatFor(1));
	paintAlong(curbL.geometry, track.samples, 3.2);
	paintAlong(curbR.geometry, track.samples, 3.2);
	paintAlong(curbFaceL.geometry, track.samples, 3.2);
	paintAlong(curbFaceR.geometry, track.samples, 3.2);
	scene.add(curbL, curbR, curbFaceL, curbFaceR);
	const wallMat = new THREE.MeshStandardMaterial({
		color: theme.kind === "yard" ? 3815476 : theme.kind === "coast" ? 4082258 : theme.kind === "core" ? 3287084 : 3291200,
		map: barrierTexture(),
		roughness: .88,
		metalness: .08
	});
	const wallH = 1.35;
	const wallAt = (sign: number, extra: number) => ribbon(track.samples, (s) => {
		const lat = (s.width * .5 + extra) * sign;
		const x = s.x + s.rx * lat;
		const z = s.z + s.rz * lat;
		return [
			x,
			s.y,
			z,
			x,
			s.y + wallH,
			z
		];
	});
	const wallTop = (sign: number) => ribbon(track.samples, (s) => {
		const inner = (s.width * .5 + .15) * sign;
		const outer = (s.width * .5 + .62) * sign;
		return [
			s.x + s.rx * inner,
			s.y + wallH,
			s.z + s.rz * inner,
			s.x + s.rx * outer,
			s.y + wallH + .02,
			s.z + s.rz * outer
		];
	});
	for (const geo of [
		wallAt(-1, .15),
		wallAt(1, .15),
		wallAt(-1, .62),
		wallAt(1, .62),
		wallTop(-1),
		wallTop(1)
	]) {
		const mesh = new THREE.Mesh(geo, wallMat);
		paintAlong(mesh.geometry, track.samples, 3.6);
		scene.add(mesh);
	}
	const cap = (sign: number, capColor: number) => new THREE.Mesh(ribbon(track.samples, (s) => {
		const h = s.width * .5 + .15;
		const x = s.x + s.rx * h * sign;
		const z = s.z + s.rz * h * sign;
		return [
			x,
			s.y + wallH,
			z,
			x + s.rx * .22 * sign,
			s.y + wallH + .1,
			z + s.rz * .22 * sign
		];
	}), new THREE.MeshStandardMaterial({
		color: 1448480,
		emissive: capColor,
		emissiveIntensity: .16,
		metalness: .55,
		roughness: .32
	}));
	scene.add(cap(-1, theme.barrierL), cap(1, theme.barrierR));
	const accent = (color: number) => new THREE.MeshStandardMaterial({
		color: 1184792,
		emissive: color,
		emissiveIntensity: .32,
		roughness: .42,
		metalness: .2
	});
	const edgeStrip = (sign: number) => ribbon(track.samples, (s) => {
		const edge = s.width * .5 + .02;
		const inner = edge - .16;
		const y = s.y + .14;
		return [
			s.x + s.rx * inner * sign,
			y,
			s.z + s.rz * inner * sign,
			s.x + s.rx * edge * sign,
			y + .015,
			s.z + s.rz * edge * sign
		];
	});
	scene.add(new THREE.Mesh(edgeStrip(-1), accent(theme.edgeL)), new THREE.Mesh(edgeStrip(1), accent(theme.edgeR)));
	const railMat = new THREE.MeshStandardMaterial({
		color: 0x8d98a4,
		metalness: .72,
		roughness: .34
	});
	const rail = (sign: number, lift: number) => new THREE.Mesh(ribbon(track.samples, (s) => {
		const inner = s.width * .5 + 3.05;
		const outer = inner + 0.1;
		return [
			s.x + s.rx * inner * sign,
			s.y + 0.55 + lift,
			s.z + s.rz * inner * sign,
			s.x + s.rx * outer * sign,
			s.y + 0.98 + lift,
			s.z + s.rz * outer * sign
		];
	}), railMat);
	scene.add(rail(-1, 0), rail(1, 0), rail(-1, 0.08), rail(1, 0.08));
	const walkMat = new THREE.MeshStandardMaterial({
		color: theme.kind === "coast" ? 2763840 : theme.kind === "yard" ? 2894376 : 2369584,
		roughness: .94,
		metalness: .02
	});
	const walk = (sign: number) => new THREE.Mesh(ribbon(track.samples, (s) => {
		const a = sign * (s.width * .5 + .85);
		const b = sign * (s.width * .5 + 2.65);
		return [
			s.x + s.rx * a,
			s.y + .02,
			s.z + s.rz * a,
			s.x + s.rx * b,
			s.y + .02,
			s.z + s.rz * b
		];
	}), walkMat);
	scene.add(walk(-1), walk(1));
	const studs = new THREE.InstancedMesh(new THREE.BoxGeometry(.18, .07, .42), new THREE.MeshBasicMaterial({
		color: 16777215,
		toneMapped: true
	}), track.samples.length);
	const studDummy = new THREE.Object3D();
	let studCount = 0;
	for (let i = 0; i < track.samples.length; i += 5) {
		const s = track.samples[i];
		for (const side of [-1, 1]) {
			const lat = (s.width * .5 - .55) * side;
			studDummy.position.set(s.x + s.rx * lat, s.y + .12, s.z + s.rz * lat);
			studDummy.rotation.set(0, Math.atan2(s.tx, s.tz), 0);
			studDummy.scale.set(1, 1, 1);
			studDummy.updateMatrix();
			studs.setMatrixAt(studCount, studDummy.matrix);
			studs.setColorAt(studCount, new THREE.Color(side < 0 ? theme.edgeL : theme.edgeR));
			studCount++;
		}
	}
	studs.count = studCount;
	if (studs.instanceColor) studs.instanceColor.needsUpdate = true;
	studs.frustumCulled = false;
	scene.add(studs);
	const dressing = new THREE.Group();
	scene.add(dressing);
	const dummy = new THREE.Object3D();
	let straight = track.samples[0];
	let straightScore = 1e9;
	let sweeper = track.samples[0];
	let chicane = track.samples[0];
	let crest = track.samples[0];
	let trough = track.samples[0];
	for (const s of track.samples) {
		const score = Math.abs(s.z - theme.straightAnchorZ) + Math.abs(s.curv) * 500;
		if (score < straightScore) {
			straightScore = score;
			straight = s;
		}
		if (s.curv < sweeper.curv) sweeper = s;
		if (s.curv > chicane.curv) chicane = s;
		if (s.y > crest.y) crest = s;
		if (s.y < trough.y) trough = s;
	}
	addGantry(dressing, straight, theme.signStraight.text, theme.signStraight.color);
	const ahead = track.samples[(track.samples.indexOf(straight) + (theme.signAhead.offset ?? 28)) % track.samples.length];
	addGantry(dressing, ahead, theme.signAhead.text, theme.signAhead.color);
	addGantry(dressing, chicane, theme.signTight.text, theme.signTight.color);
	if (theme.kind === "yard") {
		addGantry(dressing, crest, "CLIMB", "#ffb020");
		addGantry(dressing, trough, "TUNNEL", "#ffe7a8");
	}
	if (theme.kind === "coast") addGantry(dressing, crest, "BRIDGE", theme.signStraight.color);
	const chevronTex = canvasTex((g, w, h) => {
		g.clearRect(0, 0, w, h);
		g.fillStyle = "#ffe14a";
		g.beginPath();
		g.moveTo(w * .5, 8);
		g.lineTo(w - 8, h - 8);
		g.lineTo(8, h - 8);
		g.closePath();
		g.fill();
	}, 64, 64);
	chevronTex.wrapS = THREE.ClampToEdgeWrapping;
	chevronTex.wrapT = THREE.ClampToEdgeWrapping;
	const chevronGeo = new THREE.PlaneGeometry(1.5, 2.1);
	chevronGeo.rotateX(-Math.PI / 2);
	const arrows = new THREE.InstancedMesh(chevronGeo, new THREE.MeshBasicMaterial({
		map: chevronTex,
		transparent: true,
		side: THREE.DoubleSide
	}), 12);
	let ai = 0;
	for (let i = 0; i < track.samples.length && ai < 12; i += 4) {
		const s = track.samples[i];
		const n = track.samples[(i + 10) % track.samples.length];
		const turn = Math.abs(n.curv) > Math.abs(s.curv) ? n.curv : s.curv;
		if (Math.abs(turn) < .008) continue;
		const side = turn >= 0 ? 1 : -1;
		const lat = (s.width * .5 - 1.45) * side;
		dummy.position.set(s.x + s.rx * lat, s.y + .1, s.z + s.rz * lat);
		dummy.quaternion.setFromRotationMatrix(trackBasis(s.tx, s.tz, s.rx, s.rz));
		dummy.scale.set(1, 1, 1);
		dummy.updateMatrix();
		arrows.setMatrixAt(ai, dummy.matrix);
		ai++;
		i += 18;
	}
	arrows.count = ai;
	arrows.frustumCulled = false;
	scene.add(arrows);
	const finish = track.samples[0];
	const checks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, .04, .7), new THREE.MeshStandardMaterial({
		color: 16777215,
		roughness: .4,
		metalness: .05
	}), 14);
	const darkCheck = new THREE.Color(1184794);
	const lightCheck = new THREE.Color(15922939);
	for (let i = 0; i < 14; i++) {
		const lat = -finish.width * .42 + i * (finish.width * .84 / 13);
		dummy.position.set(finish.x + finish.rx * lat, finish.y + .06, finish.z + finish.rz * lat);
		dummy.quaternion.setFromRotationMatrix(trackBasis(finish.tx, finish.tz, finish.rx, finish.rz));
		dummy.scale.set(1, 1, 1);
		dummy.updateMatrix();
		checks.setMatrixAt(i, dummy.matrix);
		checks.setColorAt(i, i % 2 === 0 ? lightCheck : darkCheck);
	}
	if (checks.instanceColor) checks.instanceColor.needsUpdate = true;
	checks.frustumCulled = false;
	scene.add(checks);
	for (let i = 0; i < track.gates.length; i++) {
		const gate = track.gates[i];
		const isFinish = i === track.gates.length - 1;
		addArch(scene, gate, isFinish ? theme.finishArch : theme.arch, isFinish ? 7.4 : 4.8);
	}
	const groundTex = terrainTexture(theme.kind);
	groundTex.repeat.set(28, 28);
	const ground = new THREE.Mesh(new THREE.CircleGeometry(1900, 48), new THREE.MeshStandardMaterial({
		map: groundTex,
		color: theme.kind === "coast" ? 9352388 : 16777215,
		roughness: 1,
		metalness: 0
	}));
	ground.rotation.x = -Math.PI / 2;
	ground.position.y = theme.kind === "coast" ? track.minY - 8 : track.minY - .45;
	scene.add(ground);
	if (theme.kind === "coast") {
		const sea = new THREE.Mesh(new THREE.CircleGeometry(2400, 48), new THREE.MeshStandardMaterial({
			color: 0xffffff,
			map: canvasTex((g, w, h) => {
				const grad = g.createLinearGradient(0, 0, 0, h);
				grad.addColorStop(0, "#0d4e72");
				grad.addColorStop(0.45, "#1a7eaa");
				grad.addColorStop(1, "#0c3e5c");
				g.fillStyle = grad;
				g.fillRect(0, 0, w, h);
				g.fillStyle = "rgba(210,235,255,0.18)";
				g.fillRect(w * 0.42, 0, w * 0.16, h);
				for (let i = 0; i < 18; i++) {
					g.strokeStyle = `rgba(180,220,240,${0.05 + (i % 3) * 0.03})`;
					g.beginPath();
					g.moveTo(0, (i * h) / 18);
					g.lineTo(w, (i * h) / 18 + 6);
					g.stroke();
				}
			}, 256, 256),
			roughness: 0.35,
			metalness: 0.28,
			emissive: 0x083048,
			emissiveIntensity: 0.25,
		}));
		sea.rotation.x = -Math.PI / 2;
		sea.position.y = track.minY - .2;
		scene.add(sea);
		const glint = new THREE.Mesh(new THREE.PlaneGeometry(160, 1600), new THREE.MeshBasicMaterial({
			color: 0xd7ecff,
			transparent: true,
			opacity: 0.2,
			depthWrite: false
		}));
		glint.rotation.x = -Math.PI / 2;
		glint.position.set(-40, track.minY - .05, -80);
		scene.add(glint);
	}
	addStartGantry(dressing, track, theme);
	addScenery(dressing, track, theme);
	for (let i = 0; i < 6; i++) {
		const s = track.samples[Math.floor(i * track.samples.length / 6)];
		const warm = theme.kind === "yard";
		const lamp = new THREE.PointLight(warm ? 16771780 : theme.kind === "core" ? 15785450 : 14018751, theme.kind === "coast" ? 1.05 : 1.35, 28, 2);
		lamp.position.set(s.x + s.rx * (s.width * .5 + 3.2), s.y + 5.2, s.z + s.rz * (s.width * .5 + 3.2));
		dressing.add(lamp);
	}
	return {
		scene,
		cars: carsIn.map((entry) => {
			const view = createCarView(entry.color, entry.body, entry.rival);
			scene.add(view.root);
			return view;
		}),
		sparks: new DriftSparks(scene),
		smoke: new TireSmoke(scene),
		skids: new SkidMarks(scene),
		flashes: new ImpactFlashes(scene),
		dressing,
		miniTrack: null,
		bounds: {
			minX: track.minX,
			maxX: track.maxX,
			minZ: track.minZ,
			maxZ: track.maxZ
		}
	};
}
function addStartGantry(parent: THREE.Object3D, track: Track, theme: TrackTheme): void {
	const s = sampleAt(track, track.length - track.grid.holdBack + 8);
	const group = new THREE.Group();
	basis(group, s);
	const h = s.width * .5 + 2.7;
	const steel = new THREE.MeshStandardMaterial({
		color: 1185308,
		metalness: .7,
		roughness: .32
	});
	const postGeo = new THREE.BoxGeometry(.38, 5.2, .38);
	const left = new THREE.Mesh(postGeo, steel);
	left.position.set(-h, 2.6, 0);
	const right = new THREE.Mesh(postGeo, steel);
	right.position.set(h, 2.6, 0);
	const beam = new THREE.Mesh(new THREE.BoxGeometry(h * 2 + .4, .22, .36), steel);
	beam.position.y = 5.15;
	group.add(left, right, beam);
	const lampGeo = new THREE.BoxGeometry(.34, .16, .34);
	for (let i = 0; i < 5; i++) {
		const lamp = new THREE.Mesh(lampGeo, new THREE.MeshStandardMaterial({
			color: 1312778,
			emissive: i === 0 ? 16726843 : theme.edgeL,
			emissiveIntensity: i === 0 ? .9 : .45,
			roughness: .4
		}));
		lamp.position.set(-h * .55 + i * (h * 1.1 / 4), 4.9, 0);
		group.add(lamp);
	}
	parent.add(group);
}
function _addCoast(parent: THREE.Object3D, track: Track, theme: TrackTheme): void {
	const steel = new THREE.MeshStandardMaterial({
		color: 1845302,
		metalness: .55,
		roughness: .38
	});
	const glow = new THREE.MeshStandardMaterial({
		color: 12964058,
		metalness: .62,
		roughness: .34,
		emissive: theme.edgeL,
		emissiveIntensity: .06
	});
	const dummy = new THREE.Object3D();
	const pillars = new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 1, 1.1), steel, 48);
	let pi = 0;
	for (let i = 0; i < track.samples.length && pi < 48; i += 8) {
		const s = track.samples[i];
		const drop = s.y - track.minY;
		if (drop < 3.2) continue;
		const h = Math.max(2.2, drop - .45);
		for (const side of [-1, 1]) {
			if (pi >= 48) break;
			const lat = (s.width * .5 - 1.6) * side;
			dummy.position.set(s.x + s.rx * lat, track.minY + h * .5, s.z + s.rz * lat);
			dummy.scale.set(1, h, 1);
			dummy.rotation.set(0, 0, 0);
			dummy.updateMatrix();
			pillars.setMatrixAt(pi, dummy.matrix);
			pi++;
		}
	}
	pillars.count = pi;
	parent.add(pillars);
	const masts = new THREE.InstancedMesh(new THREE.CylinderGeometry(.28, .42, 1, 6), steel, 4);
	const blades = new THREE.InstancedMesh(new THREE.BoxGeometry(.16, 7.4, .36), glow, 12);
	let ti = 0;
	let bi = 0;
	const step = Math.max(8, Math.floor(track.samples.length / 6));
	for (let i = 0; i < track.samples.length && ti < 4; i += step) {
		const s = track.samples[i];
		if (Math.abs(s.curv) > .005) continue;
		const side = ti % 2 === 0 ? 1 : -1;
		const x = s.x + s.rx * (s.width * .5 + 18) * side;
		const z = s.z + s.rz * (s.width * .5 + 18) * side;
		dummy.position.set(x, s.y + 9, z);
		dummy.scale.set(1, 18, 1);
		dummy.rotation.set(0, 0, 0);
		dummy.updateMatrix();
		masts.setMatrixAt(ti, dummy.matrix);
		for (let b = 0; b < 3; b++) {
			dummy.position.set(x, s.y + 18, z);
			dummy.scale.set(1, 1, 1);
			dummy.rotation.set(0, Math.atan2(s.tx, s.tz), b * Math.PI * 2 / 3);
			dummy.updateMatrix();
			blades.setMatrixAt(bi, dummy.matrix);
			bi++;
		}
		ti++;
	}
	masts.count = ti;
	blades.count = bi;
	parent.add(masts, blades);
	let crest = track.samples[0];
	for (const s of track.samples) if (s.y > crest.y) crest = s;
	const tower = new THREE.Mesh(new THREE.BoxGeometry(3.2, 34, 3.2), steel);
	tower.position.set(crest.x + crest.rx * 26, crest.y + 8, crest.z + crest.rz * 26);
	const band = new THREE.Mesh(new THREE.BoxGeometry(3.7, .45, 3.7), glow);
	band.position.set(tower.position.x, crest.y + 22, tower.position.z);
	parent.add(tower, band);
	addGantry(parent, crest, "BRIDGE", theme.signStraight.color);
}
function _addCore(parent: THREE.Object3D, track: Track, theme: TrackTheme): void {
	const steel = new THREE.MeshStandardMaterial({
		color: 2364444,
		metalness: .62,
		roughness: .36
	});
	const red = new THREE.MeshStandardMaterial({
		color: 2757144,
		emissive: theme.edgeL,
		emissiveIntensity: .45,
		metalness: .4,
		roughness: .38
	});
	const blue = new THREE.MeshStandardMaterial({
		color: 1185824,
		emissive: theme.edgeR,
		emissiveIntensity: .4,
		metalness: .35,
		roughness: .38
	});
	let cx = 0;
	let cz = 0;
	for (const s of track.samples) {
		cx += s.x;
		cz += s.z;
	}
	cx /= track.samples.length;
	cz /= track.samples.length;
	const drum = new THREE.Mesh(new THREE.CylinderGeometry(7, 8.4, 16, 8), steel);
	drum.position.set(cx, track.minY + 8, cz);
	const ring = new THREE.Mesh(new THREE.TorusGeometry(9.2, .38, 6, 18), red);
	ring.rotation.x = Math.PI / 2;
	ring.position.set(cx, track.minY + 12, cz);
	const cap = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.1, 7, 6), blue);
	cap.position.set(cx, track.minY + 18, cz);
	parent.add(drum, ring, cap);
	const dummy = new THREE.Object3D();
	const pipes = new THREE.InstancedMesh(new THREE.CylinderGeometry(.32, .32, 1, 5), steel, 18);
	let pi = 0;
	for (let i = 0; i < track.samples.length && pi < 18; i += 12) {
		const s = track.samples[i];
		dummy.position.set(s.x - s.rx * (s.width * .5 + 3.5), s.y + 1.5, s.z - s.rz * (s.width * .5 + 3.5));
		dummy.scale.set(1, 3, 1);
		dummy.rotation.set(Math.PI / 2, Math.atan2(s.tx, s.tz), 0);
		dummy.updateMatrix();
		pipes.setMatrixAt(pi, dummy.matrix);
		pi++;
	}
	pipes.count = pi;
	parent.add(pipes);
	const towers = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), steel, 6);
	const lights = new THREE.InstancedMesh(new THREE.BoxGeometry(1, .22, 1), blue, 6);
	for (let i = 0; i < 6; i++) {
		const s = track.samples[(i * 23 + 5) % track.samples.length];
		const h = 11 + i % 3 * 5;
		dummy.position.set(s.x + s.rx * (s.width * .5 + 8), s.y + h * .5, s.z + s.rz * (s.width * .5 + 8));
		dummy.scale.set(2.1, h, 2.1);
		dummy.rotation.set(0, 0, 0);
		dummy.updateMatrix();
		towers.setMatrixAt(i, dummy.matrix);
		dummy.position.y = s.y + h;
		dummy.scale.set(2.4, 1, 2.4);
		dummy.updateMatrix();
		lights.setMatrixAt(i, dummy.matrix);
		lights.setColorAt(i, new THREE.Color(i % 2 === 0 ? theme.edgeL : theme.edgeR));
	}
	if (lights.instanceColor) lights.instanceColor.needsUpdate = true;
	parent.add(towers, lights);
}
function _addYard(parent: THREE.Object3D, track: Track, theme: TrackTheme): void {
	const steel = new THREE.MeshStandardMaterial({
		color: 2761758,
		metalness: .62,
		roughness: .4
	});
	const amber = new THREE.MeshStandardMaterial({
		color: 2760726,
		emissive: theme.edgeL,
		emissiveIntensity: .55,
		roughness: .42,
		metalness: .3
	});
	const warn = new THREE.MeshStandardMaterial({
		color: 2756620,
		emissive: 16730666,
		emissiveIntensity: .7,
		roughness: .4
	});
	const dummy = new THREE.Object3D();
	const pillars = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 1, 1.4), steel, 40);
	let pi = 0;
	let crest = track.samples[0];
	let trough = track.samples[0];
	for (let i = 0; i < track.samples.length; i += 6) {
		const s = track.samples[i];
		if (s.y > crest.y) crest = s;
		if (s.y < trough.y) trough = s;
		const drop = s.y - track.minY;
		if (drop < 2.2 || pi >= 40) continue;
		dummy.position.set(s.x + s.rx * (s.width * .5 + 3.2), track.minY + drop * .5, s.z + s.rz * (s.width * .5 + 3.2));
		dummy.scale.set(1, Math.max(2.2, drop), 1);
		dummy.rotation.set(0, Math.atan2(s.tx, s.tz), 0);
		dummy.updateMatrix();
		pillars.setMatrixAt(pi, dummy.matrix);
		pi++;
	}
	pillars.count = pi;
	parent.add(pillars);
	const tower = new THREE.Group();
	basis(tower, crest);
	const shaft = new THREE.Mesh(new THREE.BoxGeometry(7, 28, 7), steel);
	shaft.position.set(-(crest.width * .5 + 16), 6, 0);
	const band = new THREE.Mesh(new THREE.BoxGeometry(7.4, .45, 7.4), amber);
	band.position.set(shaft.position.x, 16, 0);
	const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), warn);
	lamp.position.set(shaft.position.x, 20.2, 0);
	tower.add(shaft, band, lamp);
	parent.add(tower);
	addGantry(parent, crest, "CLIMB", "#ffb020");
	addGantry(parent, trough, "TUNNEL", "#ffe7a8");
	const cableMat = new THREE.MeshBasicMaterial({ color: 9072728 });
	for (let i = 8; i < track.samples.length; i += 22) {
		const a = track.samples[i];
		const b = track.samples[(i + 11) % track.samples.length];
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const dz = b.z - a.z;
		const len = Math.hypot(dx, dy, dz);
		if (len < 4) continue;
		const cable = new THREE.Mesh(new THREE.BoxGeometry(.08, .08, len), cableMat);
		cable.position.set((a.x + b.x) / 2 + a.rx * (a.width * .5 + 6), (a.y + b.y) / 2 + 4.5, (a.z + b.z) / 2 + a.rz * (a.width * .5 + 6));
		cable.lookAt(b.x, b.y + 4.5, b.z);
		parent.add(cable);
	}
}
function _addTunnel(parent: THREE.Object3D, track: Track, theme: TrackTheme): void {
	const limit = theme.tunnelBelow;
	if (limit == null) return;
	const picks = [];
	for (let i = 0; i < track.samples.length; i += 3) {
		const s = track.samples[i];
		if (s.y <= limit) picks.push(s);
	}
	if (picks.length < 4) return;
	const dummy = new THREE.Object3D();
	const roof = new THREE.InstancedMesh(new THREE.BoxGeometry(1, .28, 1.8), new THREE.MeshStandardMaterial({
		color: 1445912,
		roughness: .7,
		metalness: .4,
		emissive: theme.barrierL,
		emissiveIntensity: .06
	}), picks.length);
	for (let i = 0; i < picks.length; i++) {
		const s = picks[i];
		dummy.position.set(s.x, s.y + 3.55, s.z);
		dummy.quaternion.setFromRotationMatrix(trackBasis(s.tx, s.tz, s.rx, s.rz));
		dummy.scale.set(s.width + .4, 1, 1);
		dummy.updateMatrix();
		roof.setMatrixAt(i, dummy.matrix);
	}
	parent.add(roof);
}
const SHARED_GEOS = new Set(Object.values(geos));

export function releaseObject(root: THREE.Object3D): void {
	root.traverse((obj) => {
		const mesh = obj as THREE.Mesh;
		if (mesh.geometry && !SHARED_GEOS.has(mesh.geometry)) mesh.geometry.dispose();
		const material = mesh.material;
		if (!material) return;
		const list = Array.isArray(material) ? material : [material];
		for (const mat of list) mat.dispose();
	});
}
export function disposeBundle(bundle: SceneBundle): void {
	bundle.scene.traverse((obj) => {
		const mesh = obj as THREE.Mesh;
		if (mesh.geometry && !SHARED_GEOS.has(mesh.geometry)) mesh.geometry.dispose();
		const material = mesh.material;
		if (!material) return;
		const list = Array.isArray(material) ? material : [material];
		for (const mat of list) {
			const mapped = mat as THREE.MeshStandardMaterial;
			if (mapped.roughnessMap && mapped.roughnessMap !== mapped.map) mapped.roughnessMap.dispose();
			if (mapped.emissiveMap && mapped.emissiveMap !== mapped.map) mapped.emissiveMap.dispose();
			if (mapped.map) mapped.map.dispose();
			mat.dispose();
		}
	});
}
export function syncCar(view: CarView, car: CarState, pitch: number, vis?: CarVis): void {
	const x = vis ? vis.x : car.x;
	const y = vis ? vis.y : car.y;
	const z = vis ? vis.z : car.z;
	const yaw = vis ? vis.yaw : car.yaw;
	const bodyPitch = vis ? vis.pitch : car.bodyPitch;
	const bodyRoll = vis ? vis.roll : car.bodyRoll;
	const fx = -Math.sin(yaw);
	const fz = -Math.cos(yaw);
	view.root.position.set(x, y, z);
	view.root.up.set(0, 1, 0);
	if (car.airborne) {
		view.root.lookAt(x + fx, y + pitch, z + fz);
		view.chassis.rotation.set(0, 0, bodyRoll * 0.35);
	} else {
		view.root.lookAt(x + fx, y, z + fz);
		view.chassis.rotation.set(-bodyPitch * 0.7, 0, bodyRoll * 0.8);
	}
	for (const w of view.wheels) w.rotation.x = vis ? vis.spin : car.wheelSpin;
	for (const p of view.frontPivots) p.rotation.y = (vis ? vis.steer : car.steerVisual) * .42;
  const brake = car.brakeVisual;
  view.brakeMat.emissiveIntensity = .25 + brake * brake * 4.5;
  view.tailLight.intensity = .12 + brake * brake * 2.8;
  view.boost.visible = car.boostBlend > .05;
  const stretch = .45 + car.boostBlend * 1.35;
  view.boost.scale.set(1, 1, stretch);
  view.boostLight.intensity = car.boosting ? 1.4 + car.boostBlend * 2.4 : 0;
  view.paint.emissiveIntensity = .03 + car.crashPulse * .45 + (car.boosting ? .1 : 0);
	const glowMat = view.glow.material as THREE.MeshBasicMaterial;
	glowMat.opacity = (view.hero ? .1 : .04) + (car.boosting ? .16 : 0);
}
const SPARK_N = 80;
class DriftSparks {
	points: THREE.Points;
	pos: Float32Array;
	vel: Float32Array;
	life: Float32Array;
	cursor = 0;
	constructor(scene: THREE.Scene) {
		this.pos = /* @__PURE__ */ new Float32Array(240);
		this.vel = /* @__PURE__ */ new Float32Array(240);
		this.life = new Float32Array(SPARK_N);
		const geo = new THREE.BufferGeometry();
		geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
		const mat = new THREE.PointsMaterial({
			color: 16765600,
			size: .14,
			transparent: true,
			opacity: .8,
			depthWrite: false,
			toneMapped: false
		});
		this.points = new THREE.Points(geo, mat);
		this.points.frustumCulled = false;
		scene.add(this.points);
		for (let i = 0; i < SPARK_N; i++) this.pos[i * 3 + 1] = -50;
	}
	spawn(x: number, y: number, z: number, vx: number, vz: number) {
		const i = this.cursor;
		this.cursor = (this.cursor + 1) % SPARK_N;
		this.pos[i * 3] = x;
		this.pos[i * 3 + 1] = y + .25;
		this.pos[i * 3 + 2] = z;
		this.vel[i * 3] = vx * .12 + (Math.random() - .5) * 1.4;
		this.vel[i * 3 + 1] = .6 + Math.random() * .8;
		this.vel[i * 3 + 2] = vz * .12 + (Math.random() - .5) * 1.4;
		this.life[i] = .28 + Math.random() * .18;
	}
	update(dt: number) {
		for (let i = 0; i < SPARK_N; i++) {
			if (this.life[i] <= 0) continue;
			this.life[i] -= dt;
			this.pos[i * 3] += this.vel[i * 3] * dt;
			this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
			this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
			this.vel[i * 3 + 1] -= 5 * dt;
			if (this.life[i] <= 0) this.pos[i * 3 + 1] = -50;
		}
		this.points.geometry.getAttribute("position").needsUpdate = true;
	}
};
const SMOKE_N = 96;
class TireSmoke {
	points: THREE.Points;
	pos: Float32Array;
	vel: Float32Array;
	life: Float32Array;
	cursor = 0;
	constructor(scene: THREE.Scene) {
		this.pos = /* @__PURE__ */ new Float32Array(288);
		this.vel = /* @__PURE__ */ new Float32Array(288);
		this.life = new Float32Array(SMOKE_N);
		const geo = new THREE.BufferGeometry();
		geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
		const mat = new THREE.PointsMaterial({
			color: 12041926,
			size: .9,
			transparent: true,
			opacity: .32,
			depthWrite: false
		});
		this.points = new THREE.Points(geo, mat);
		this.points.frustumCulled = false;
		scene.add(this.points);
		for (let i = 0; i < SMOKE_N; i++) this.pos[i * 3 + 1] = -40;
	}
	puff(x: number, y: number, z: number, vx: number, vz: number) {
		const i = this.cursor;
		this.cursor = (this.cursor + 1) % SMOKE_N;
		this.pos[i * 3] = x;
		this.pos[i * 3 + 1] = y + .12;
		this.pos[i * 3 + 2] = z;
		this.vel[i * 3] = vx * .02 + (Math.random() - .5) * .35;
		this.vel[i * 3 + 1] = .4 + Math.random() * .35;
		this.vel[i * 3 + 2] = vz * .02 + (Math.random() - .5) * .35;
		this.life[i] = .4 + Math.random() * .25;
	}
	update(dt: number) {
		for (let i = 0; i < SMOKE_N; i++) {
			if (this.life[i] <= 0) continue;
			this.life[i] -= dt;
			this.pos[i * 3] += this.vel[i * 3] * dt;
			this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
			this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
			if (this.life[i] <= 0) this.pos[i * 3 + 1] = -40;
		}
		this.points.geometry.getAttribute("position").needsUpdate = true;
	}
};
const SKID_N = 140;
class SkidMarks {
	mesh: THREE.InstancedMesh;
	cursor = 0;
	dummy = new THREE.Object3D();
	constructor(scene: THREE.Scene) {
		const geo = new THREE.PlaneGeometry(.22, .85);
		geo.rotateX(-Math.PI / 2);
		const mat = new THREE.MeshBasicMaterial({
			color: 460812,
			transparent: true,
			opacity: .42,
			depthWrite: false
		});
		this.mesh = new THREE.InstancedMesh(geo, mat, SKID_N);
		this.mesh.frustumCulled = false;
		this.dummy.position.set(0, -20, 0);
		this.dummy.updateMatrix();
		for (let i = 0; i < SKID_N; i++) this.mesh.setMatrixAt(i, this.dummy.matrix);
		scene.add(this.mesh);
	}
	drop(x: number, y: number, z: number, yaw: number) {
		this.dummy.position.set(x, y + .05, z);
		this.dummy.rotation.set(0, yaw, 0);
		this.dummy.scale.set(1, 1, 1);
		this.dummy.updateMatrix();
		this.mesh.setMatrixAt(this.cursor, this.dummy.matrix);
		this.cursor = (this.cursor + 1) % SKID_N;
		this.mesh.instanceMatrix.needsUpdate = true;
	}
};
class ImpactFlashes {
	meshes: THREE.Mesh[] = [];
	life: number[] = [];
	cursor = 0;
	constructor(scene: THREE.Scene) {
		const geo = new THREE.PlaneGeometry(1, 1);
		for (let i = 0; i < 4; i++) {
			const mat = new THREE.MeshBasicMaterial({
				color: 16774365,
				transparent: true,
				opacity: 0,
				depthWrite: false,
				toneMapped: false,
				side: THREE.DoubleSide
			});
			const mesh = new THREE.Mesh(geo, mat);
			mesh.visible = false;
			mesh.renderOrder = 2;
			scene.add(mesh);
			this.meshes.push(mesh);
			this.life.push(0);
		}
	}
	burst(x: number, y: number, z: number, scale: number) {
		const i = this.cursor;
		this.cursor = (this.cursor + 1) % this.meshes.length;
		const mesh = this.meshes[i];
		mesh.visible = true;
		mesh.position.set(x, y + .7, z);
		mesh.scale.setScalar(.6 + scale * 1.6);
		mesh.lookAt(x, y + 2, z + 1);
		(mesh.material as THREE.MeshBasicMaterial).opacity = .85;
		this.life[i] = .12 + scale * .08;
	}
	update(dt: number) {
		for (let i = 0; i < this.meshes.length; i++) {
			if (this.life[i] <= 0) continue;
			this.life[i] -= dt;
			const mat = this.meshes[i]!.material as THREE.MeshBasicMaterial;
			mat.opacity = Math.max(0, this.life[i] * 5);
			if (this.life[i] <= 0) this.meshes[i].visible = false;
		}
	}
};
export function drawMinimap(ctx: CanvasRenderingContext2D, track: Track, cars: readonly CarState[], w: number, h: number, vis?: readonly CarVis[]): void {
	ctx.clearRect(0, 0, w, h);
	ctx.fillStyle = "rgba(6, 10, 18, 0.78)";
	ctx.fillRect(0, 0, w, h);
	const spanX = Math.max(1, track.maxX - track.minX);
	const spanZ = Math.max(1, track.maxZ - track.minZ);
	const scale = Math.min((w - 24) / spanX, (h - 24) / spanZ);
	const ox = (w - spanX * scale) / 2;
	const oy = (h - spanZ * scale) / 2;
	const px = (x: number) => ox + (x - track.minX) * scale;
	const py = (z: number) => oy + (z - track.minZ) * scale;
	const samples = track.samples;
	const n = samples.length;
	ctx.beginPath();
	for (let i = 0; i < n; i++) {
		const s = samples[i];
		const half = s.width * .5;
		const x = px(s.x + s.rx * half);
		const y = py(s.z + s.rz * half);
		if (i === 0) ctx.moveTo(x, y);
		else ctx.lineTo(x, y);
	}
	for (let i = n - 1; i >= 0; i--) {
		const s = samples[i];
		const half = s.width * .5;
		ctx.lineTo(px(s.x - s.rx * half), py(s.z - s.rz * half));
	}
	ctx.closePath();
	ctx.fillStyle = "rgba(54, 62, 74, 0.95)";
	ctx.fill();
	ctx.lineWidth = 1;
	ctx.strokeStyle = "rgba(220, 230, 240, 0.35)";
	ctx.stroke();
	const start = samples[0];
	ctx.fillStyle = "#f4f7fb";
	ctx.fillRect(px(start.x) - 2, py(start.z) - 2, 4, 4);
	for (let i = 0; i < cars.length; i++) {
		const car = cars[i];
		if (car.y < -20) continue;
		const pose = vis?.[i];
		const x = pose ? pose.x : car.x;
		const z = pose ? pose.z : car.z;
		const yaw = pose ? pose.yaw : car.yaw;
		const fx = -Math.sin(yaw);
		const fz = -Math.cos(yaw);
		ctx.save();
		ctx.translate(px(x), py(z));
		ctx.fillStyle = car.isPlayer ? "#f7fbff" : `#${car.color.toString(16).padStart(6, "0")}`;
		ctx.beginPath();
		ctx.moveTo(fx * 7, fz * 7);
		ctx.lineTo(-fz * 3.2 - fx * 3, fx * 3.2 - fz * 3);
		ctx.lineTo(fz * 3.2 - fx * 3, -fx * 3.2 - fz * 3);
		ctx.closePath();
		ctx.fill();
		ctx.restore();
	}
}
