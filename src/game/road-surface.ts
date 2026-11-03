import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { sampleAt, type Sample, type Track } from "./track";
import type { TrackTheme } from "./track-def";
import {
  KERB_CROWN,
  KERB_FRONT,
  KERB_FLOOR,
  KERB_OUT,
  KERB_W,
  STUD_H,
  kerbCrossSlope,
  kerbRunIndices,
  kerbStudLat,
  kerbStudSurface,
  kerbWeightProfile,
} from "./kerb";
import { faceToward } from "./road-winding";
import { ROAD_DECK_Y } from "./contact";

/**
 * Road / asphalt / kerb / barrier presentation for every circuit.
 *
 * Purely visual: physics, AI and timing only ever read `track.samples`, so
 * nothing built here can affect driving. Every strip is generated from the
 * same sample basis as the track (centreline + right vector), so elevation,
 * width and curvature follow the course exactly, and the loop closes cleanly
 * because samples wrap (i -> i + 1 mod n); the closing station duplicates the
 * first one with a continuous `dist`, so no texture smears across the seam.
 *
 * Winding note: each generated strip is oriented toward its intended visible
 * side and has normals recomputed after the index order is corrected. Road,
 * kerb, walkway and barrier faces use FrontSide; only the thin outer wall sheet
 * stays DoubleSide because it is visible from both the track slot and outside.
 */

export type RoadSurfaces = {
  /** Everything you built, ready for scene.add(). */
  group: THREE.Group;
  /** Textures + materials + geometries you created; called by the parent in disposeBundle(). */
  dispose: () => void;
};

/** Deck top above the sample centreline (same convention as the old road ribbon). */
const SURFACE = ROAD_DECK_Y;
/** Slab thickness below the deck. */
const DECK = 0.14;
/** Deck overhang so the slab reaches under the barrier face (no slot at the edge). */
const EDGE_PAD = 0.18;
const WALL_H = 1.35;
const WALL_IN = 0.15;
const WALL_OUT = 0.62;
const CAP_OUT = 0.37;
const WALK_Y = 0.02;
/** The walkway now starts at the wall base and runs past the rail line, so the
 *  guardrail posts stand on deck instead of hanging over open air. */
const WALK_IN = WALL_OUT;
const WALK_OUT = 3.35;
const RAIL_INNER = 3.05;
const RAIL_SPAN = 0.1;
const RAIL_Y = 0.55;
const RAIL_H = 0.43;
const RAIL_LIFT = 0.08;
const RAIL_TOP = RAIL_Y + RAIL_H + RAIL_LIFT;
const POST_LAT = 3.1;
const POST_GAP = 5.5;
const POST_H = RAIL_TOP + 0.04 - WALK_Y;
/** Kerb stripes repeat every 4 m: 4 bands per tile => 1 m stripes. */
const KERB_TILE = 4;
const WALL_TILE = 3.6;
const LINE_TILE = 12;
/** Asphalt UV tile length in metres. */
const ROAD_TILE = 9;
const STUD_EVERY = 5;
/** Peak alpha budgets for the surface decals (spec: keep them under ~0.35). */
const LINE_ALPHA = 0.34;
const PATCH_ALPHA = 0.32;

/** Deterministic stand-in for R so a track looks the same every load. */
let drawRandom: () => number = R;

function R(): number {
  return drawRandom();
}

export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable seed for one circuit theme. Same kind + citySeed => same textures. */
export function roadTextureSeed(kind: string, citySeed: number): number {
  let h = (citySeed >>> 0) ^ 0x9e3779b9;
  for (let i = 0; i < kind.length; i++) h = Math.imul(h ^ kind.charCodeAt(i), 0x85ebca6b);
  return h >>> 0;
}

export function withRoadSeed<T>(seed: number, fn: (random: () => number) => T): T {
  const prev = drawRandom;
  drawRandom = mulberry32(seed);
  const random = () => drawRandom();
  try {
    return fn(random);
  } finally {
    drawRandom = prev;
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smooth01(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Value noise whose lattice wraps at `cells`, so the canvas tiles seamlessly. */
function tileNoise(
  x: number,
  y: number,
  w: number,
  h: number,
  cellsX: number,
  cellsY: number,
  seed: number,
): number {
  const fx = (x / w) * cellsX;
  const fy = (y / h) * cellsY;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = smooth01(fx - x0);
  const ty = smooth01(fy - y0);
  const x1 = (x0 + 1) % cellsX;
  const y1 = (y0 + 1) % cellsY;
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * ty;
}

function canvasTex(
  draw: (g: CanvasRenderingContext2D, w: number, h: number) => void,
  w: number,
  h: number,
): THREE.CanvasTexture {
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

function dataTex(
  draw: (g: CanvasRenderingContext2D, w: number, h: number) => void,
  w: number,
  h: number,
): THREE.CanvasTexture {
  const tex = canvasTex(draw, w, h);
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  return tex;
}

/**
 * Asphalt: seamless stochastic grain only. The old texture baked dark bands at
 * 22%/70% of the width (plus centre dashes) which read as tiling artifacts;
 * here the only baked structure is low-contrast tonal noise, aggregate stones
 * and the painted edge lines themselves.
 */
function asphaltMap(theme: TrackTheme): THREE.CanvasTexture {
  const kind = theme.kind;
  const base =
    kind === "yard"
      ? [62, 56, 48]
      : kind === "coast"
        ? [64, 70, 76]
        : kind === "core"
          ? [58, 54, 56]
          : [60, 62, 66];
  const w = 512;
  const h = 512;
  return canvasTex(
    (g, cw, ch) => {
      // Tonal variation: three octaves of periodic value noise, deliberately low
      // contrast so a 9 m tile never announces itself.
      const img = g.createImageData(cw, ch);
      const data = img.data;
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          const shade =
            (tileNoise(x, y, cw, ch, 8, 8, 1) - 0.5) * 5 +
            (tileNoise(x, y, cw, ch, 32, 32, 2) - 0.5) * 6 +
            (tileNoise(x, y, cw, ch, 128, 128, 3) - 0.5) * 7;
          const i = (y * cw + x) * 4;
          data[i] = clampByte(base[0] + shade);
          data[i + 1] = clampByte(base[1] + shade);
          data[i + 2] = clampByte(base[2] + shade);
          data[i + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);

      // Aggregate: thousands of 1-2 px stones (wrapped at the edges so the tile
      // repeats without a seam).
      for (let i = 0; i < 14000; i++) {
        const x = Math.floor(R() * cw);
        const y = Math.floor(R() * ch);
        const up = R() > 0.5;
        const delta = 16 + R() * 34;
        const c = up
          ? [base[0] + delta, base[1] + delta, base[2] + delta]
          : [base[0] - delta, base[1] - delta, base[2] - delta];
        g.fillStyle = `rgba(${clampByte(c[0])},${clampByte(c[1])},${clampByte(c[2])},0.5)`;
        const size = R() > 0.72 ? 2 : 1;
        g.fillRect(x, y, size, size);
        if (x < size) g.fillRect(x + cw, y, size, size);
        if (y < size) g.fillRect(x, y + ch, size, size);
        if (x < size && y < size) g.fillRect(x + cw, y + ch, size, size);
      }

      // Scattered soft irregularities keep it from reading as flat plastic.
      for (let i = 0; i < 30; i++) {
        const cx = R() * cw;
        const cy = R() * ch;
        const r = 26 + R() * 70;
        const lift = R() > 0.5;
        const a = 0.05 + R() * 0.06;
        const c = lift
          ? [base[0] + 12, base[1] + 11, base[2] + 10]
          : [base[0] - 12, base[1] - 12, base[2] - 11];
        for (const dx of [-cw, 0, cw]) {
          for (const dy of [-ch, 0, ch]) {
            const grad = g.createRadialGradient(cx + dx, cy + dy, 0, cx + dx, cy + dy, r);
            grad.addColorStop(
              0,
              `rgba(${clampByte(c[0])},${clampByte(c[1])},${clampByte(c[2])},${a})`,
            );
            grad.addColorStop(
              1,
              `rgba(${clampByte(c[0])},${clampByte(c[1])},${clampByte(c[2])},0)`,
            );
            g.fillStyle = grad;
            g.fillRect(cx + dx - r, cy + dy - r, r * 2, r * 2);
          }
        }
      }

      // Painted edge lines. `u` runs across the road width (0 = left edge), so a
      // constant column is a straight line a fixed distance from each edge.
      const lineW = Math.max(3, Math.round(cw * 0.008));
      const lines: Array<{ x: number; color: string }> = [
        { x: cw * 0.045, color: `#${new THREE.Color(theme.edgeL).getHexString()}` },
        { x: cw * 0.955, color: `#${new THREE.Color(theme.edgeR).getHexString()}` },
      ];
      g.globalAlpha = 0.9;
      for (const line of lines) {
        g.fillStyle = line.color;
        g.fillRect(line.x - lineW / 2, 0, lineW, ch);
      }
      g.globalAlpha = 1;

      // Wear scuffs so the paint never looks like a fresh decal.
      g.fillStyle = `rgba(${base[0]},${base[1]},${base[2]},0.55)`;
      for (const line of lines) {
        for (let i = 0; i < 150; i++) {
          const y = Math.floor(R() * ch);
          const x = line.x + (R() - 0.5) * lineW * 1.7;
          g.fillRect(x, y, 1 + Math.floor(R() * 2), 1 + Math.floor(R() * 3));
        }
      }
      // Fine wear speckle across the whole surface.
      for (let i = 0; i < 900; i++) {
        const x = Math.floor(R() * cw);
        const y = Math.floor(R() * ch);
        const delta = 14 + R() * 26;
        const up = R() > 0.45;
        const c = up
          ? [base[0] + delta, base[1] + delta, base[2] + delta]
          : [base[0] - delta, base[1] - delta, base[2] - delta];
        g.fillStyle = `rgba(${clampByte(c[0])},${clampByte(c[1])},${clampByte(c[2])},0.4)`;
        g.fillRect(x, y, 1, 1);
      }
    },
    w,
    h,
  );
}

/** Roughness: raw aggregate is rough, rubbered-in/polished patches are smoother. */
function asphaltRoughness(): THREE.CanvasTexture {
  const w = 256;
  const h = 256;
  return dataTex(
    (g, cw, ch) => {
      const img = g.createImageData(cw, ch);
      const data = img.data;
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          const n =
            (tileNoise(x, y, cw, ch, 24, 24, 11) - 0.5) * 34 +
            (tileNoise(x, y, cw, ch, 96, 96, 12) - 0.5) * 26;
          const v = clampByte(228 + n);
          const i = (y * cw + x) * 4;
          data[i] = v;
          data[i + 1] = v;
          data[i + 2] = v;
          data[i + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
      // Smoother patches: rubbered-in and polished areas.
      for (let i = 0; i < 26; i++) {
        const cx = R() * cw;
        const cy = R() * ch;
        const r = 20 + R() * 54;
        const v = 130 + Math.floor(R() * 45);
        for (const dx of [-cw, 0, cw]) {
          for (const dy of [-ch, 0, ch]) {
            const grad = g.createRadialGradient(cx + dx, cy + dy, 0, cx + dx, cy + dy, r);
            grad.addColorStop(0, `rgba(${v},${v},${v},0.7)`);
            grad.addColorStop(1, `rgba(${v},${v},${v},0)`);
            g.fillStyle = grad;
            g.fillRect(cx + dx - r, cy + dy - r, r * 2, r * 2);
          }
        }
      }
      for (let i = 0; i < 1600; i++) {
        const v = clampByte(210 + (R() - 0.5) * 70);
        g.fillStyle = `rgb(${v},${v},${v})`;
        const x = Math.floor(R() * cw);
        const y = Math.floor(R() * ch);
        g.fillRect(x, y, 2, 2);
        if (x < 2) g.fillRect(x + cw, y, 2, 2);
        if (y < 2) g.fillRect(x, y + ch, 2, 2);
      }
    },
    w,
    h,
  );
}

/**
 * Kerb stripes: 4 bands per 4 m tile => 1 m stripes, 2 m light/dark repeat.
 * One texture serves both sides of the track (left half = side A, right half =
 * side B) so every circuit keeps its per-side dark tint within a single texture.
 */
function curbTexture(
  lightA: string,
  darkA: string,
  lightB: string,
  darkB: string,
): THREE.CanvasTexture {
  return canvasTex(
    (g, w, h) => {
      for (let y = 0; y < h; y += 16) {
        const lightBand = (y / 16) % 2 === 0;
        g.fillStyle = lightBand ? lightA : darkA;
        g.fillRect(0, y, w / 2, 16);
        g.fillStyle = lightBand ? lightB : darkB;
        g.fillRect(w / 2, y, w / 2, 16);
      }
      g.fillStyle = "rgba(10,12,14,0.14)";
      for (let i = 0; i < 160; i++) {
        g.fillRect(Math.floor(R() * w), Math.floor(R() * h), 2, 2);
      }
    },
    64,
    64,
  );
}

/** Barrier panels: identical to the previous wall texture (circuit parity). */
function barrierTexture(): THREE.CanvasTexture {
  return canvasTex(
    (g, w, h) => {
      g.fillStyle = "#b7c0c8";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#8d98a2";
      g.fillRect(0, h * 0.62, w, h * 0.38);
      for (let i = 0; i < 40; i++) {
        const v = 90 + R() * 40;
        g.fillStyle = `rgba(${v},${v},${v},0.25)`;
        g.fillRect(R() * w, R() * h, 2, 3);
      }
      g.fillStyle = "rgba(16,18,22,0.45)";
      g.fillRect(0, h - 5, w, 5);
      g.fillStyle = "rgba(255,255,255,0.28)";
      g.fillRect(0, 0, w, 3);
    },
    32,
    64,
  );
}

/** Feathered, ragged rubber band: alpha falls off across `u`, density varies along `v`. */
function racingLineTexture(): THREE.CanvasTexture {
  const w = 64;
  const h = 128;
  return canvasTex(
    (g, cw, ch) => {
      const img = g.createImageData(cw, ch);
      const data = img.data;
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          const t = x / (cw - 1);
          const feather = Math.pow(Math.sin(Math.PI * t), 1.5);
          const density = 0.35 + 0.65 * tileNoise(x, y, cw, ch, 8, 24, 21);
          const ragged = 0.55 + 0.45 * tileNoise(x, y, cw, ch, 4, 12, 22);
          const a = clamp01(feather * density * ragged) * LINE_ALPHA;
          const i = (y * cw + x) * 4;
          data[i] = 20;
          data[i + 1] = 19;
          data[i + 2] = 18;
          data[i + 3] = clampByte(a * 255);
        }
      }
      g.putImageData(img, 0, 0);
    },
    w,
    h,
  );
}

/** Soft irregular blob for the braking reference patches. */
function brakePatchTexture(): THREE.CanvasTexture {
  const w = 64;
  const h = 64;
  return canvasTex(
    (g, cw, ch) => {
      const grad = g.createRadialGradient(cw / 2, ch / 2, 2, cw / 2, ch / 2, cw / 2 - 1);
      grad.addColorStop(0, `rgba(15,13,12,${PATCH_ALPHA})`);
      grad.addColorStop(0.55, `rgba(15,13,12,${PATCH_ALPHA * 0.62})`);
      grad.addColorStop(1, "rgba(15,13,12,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, cw, ch);
      g.globalCompositeOperation = "source-atop";
      for (let i = 0; i < 60; i++) {
        const x = R() * cw;
        const y = R() * ch;
        const v = R() > 0.5 ? 32 : 6;
        g.fillStyle = `rgba(${v},${v},${v},0.16)`;
        g.fillRect(x, y, 2 + Math.floor(R() * 4), 1 + Math.floor(R() * 3));
      }
      g.globalCompositeOperation = "source-over";
    },
    w,
    h,
  );
}

/** Grid paint: neutral white warmed by the circuit's grid tint, if it has one. */
function gridPaint(theme: TrackTheme): number {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(theme.gridLine);
  if (!m) return 0xeef2f6;
  const mix = (c: string) => Math.round(0.78 * 255 + 0.22 * Number(c));
  return (mix(m[1]) << 16) | (mix(m[2]) << 8) | mix(m[3]);
}

type Station = {
  a: [number, number, number];
  b: [number, number, number];
  v: number;
  ua: number;
  ub: number;
};

/** Point at lateral offset `lat` (along the right vector) and height `y`. */
function at(s: Sample, lat: number, y: number): [number, number, number] {
  return [s.x + s.rx * lat, y, s.z + s.rz * lat];
}

function station(
  a: [number, number, number],
  b: [number, number, number],
  v: number,
  ua = 0,
  ub = 1,
): Station {
  return { a, b, v, ua, ub };
}

/**
 * Two-vertex strip. Surface builders orient the indices for their visible face
 * and then recalculate normals before the geometry reaches a material.
 */
function ribbon(stations: Station[], closed: boolean): THREE.BufferGeometry {
  const n = stations.length;
  const positions = new Float32Array(n * 6);
  const uvs = new Float32Array(n * 4);
  const indices: number[] = [];
  for (let i = 0; i < n; i++) {
    const st = stations[i];
    positions.set(st.a, i * 6);
    positions.set(st.b, i * 6 + 3);
    uvs[i * 4] = st.ua;
    uvs[i * 4 + 1] = st.v;
    uvs[i * 4 + 2] = st.ub;
    uvs[i * 4 + 3] = st.v;
  }
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const i2 = (i + 1) % n;
    const a = i * 2;
    const b = a + 1;
    const c = i2 * 2;
    const d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

const FACE_UP = new THREE.Vector3(0, 1, 0);
const FACE_DOWN = new THREE.Vector3(0, -1, 0);
const FACE_SIDE = new THREE.Vector3();

/** Recompute normals so the strip faces `dir`, then keep that winding. */
function face(geo: THREE.BufferGeometry, dir: THREE.Vector3): THREE.BufferGeometry {
  faceToward(geo, dir);
  return geo;
}

function faceUp(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  return face(geo, FACE_UP);
}

function faceDown(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  return face(geo, FACE_DOWN);
}

/** `sign` +1 faces the track's right vector (outside the right barrier). */
function faceSign(geo: THREE.BufferGeometry, sign: number, s: Sample): THREE.BufferGeometry {
  FACE_SIDE.set(s.rx * sign, 0, s.rz * sign);
  return face(geo, FACE_SIDE);
}

/**
 * Several open strips merged into one geometry — used to batch every kerb run
 * of one side/face into a single draw call instead of one mesh per run.
 */
function multiRibbon(strips: Station[][]): THREE.BufferGeometry {
  let vertices = 0;
  for (const strip of strips) vertices += strip.length * 2;
  const positions = new Float32Array(vertices * 6);
  const uvs = new Float32Array(vertices * 4);
  const indices: number[] = [];
  let base = 0;
  for (const strip of strips) {
    const n = strip.length;
    for (let i = 0; i < n; i++) {
      const st = strip[i];
      positions.set(st.a, (base + i * 2) * 3);
      positions.set(st.b, (base + i * 2 + 1) * 3);
      uvs[(base + i * 2) * 2] = st.ua;
      uvs[(base + i * 2) * 2 + 1] = st.v;
      uvs[(base + i * 2 + 1) * 2] = st.ub;
      uvs[(base + i * 2 + 1) * 2 + 1] = st.v;
    }
    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, c, b, b, c, d);
    }
    base += n * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Full-loop stations with continuous `v`: the closing copy of station 0 carries
 * `length / tile`, so the seam quad does not stretch the texture.
 */
function loopStations(
  samples: Sample[],
  length: number,
  tile: number,
  place: (s: Sample) => { a: [number, number, number]; b: [number, number, number] },
): Station[] {
  const out: Station[] = samples.map((s) => {
    const p = place(s);
    return station(p.a, p.b, s.dist / tile);
  });
  const first = place(samples[0]);
  out.push(station(first.a, first.b, length / tile));
  return out;
}

/**
 * Kerb runs come from kerb.ts — the same filter the simulator uses — so a stud
 * cannot sit on a run the car will never ride, or miss one it will.
 */
function kerbWeights(samples: Sample[]): { weights: Float32Array; runs: number[][] } {
  return { weights: kerbWeightProfile(samples), runs: kerbRunIndices(samples) };
}

/** Guardrail post with a foot plate; origin at the walkway so scale.y sets height. */
function postGeometry(): THREE.BufferGeometry {
  const post = new THREE.BoxGeometry(0.13, 1, 0.13);
  post.translate(0, 0.5, 0);
  const foot = new THREE.BoxGeometry(0.3, 0.07, 0.24);
  foot.translate(0, 0.035, 0);
  const merged = mergeGeometries([post, foot], false);
  if (merged) {
    post.dispose();
    foot.dispose();
    return merged;
  }
  foot.dispose();
  return post;
}

/** Track basis that follows the road plane (X = driver's left, Z = travel). */
function trackBasis(s: Sample): THREE.Matrix4 {
  const x = new THREE.Vector3(-s.rx, 0, -s.rz);
  const z = new THREE.Vector3(s.tx, s.ty, s.tz);
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  return new THREE.Matrix4().makeBasis(x, y, z);
}

/** Four painted corner strips forming one start box, in world space. */
function gridBoxGeometry(
  boxes: { m: THREE.Matrix4; w: number; l: number; t: number }[],
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const tmp = new THREE.Vector3();
  const quad = (m: THREE.Matrix4, x0: number, x1: number, z0: number, z1: number): void => {
    const base = positions.length / 3;
    const pts: Array<[number, number]> = [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ];
    for (const [px, pz] of pts) {
      tmp.set(px, 0, pz).applyMatrix4(m);
      positions.push(tmp.x, tmp.y, tmp.z);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (const box of boxes) {
    const hw = box.w * 0.5;
    const hl = box.l * 0.5;
    const t = box.t;
    quad(box.m, -hw, -hw + t, -hl, hl); // left rail
    quad(box.m, hw - t, hw, -hl, hl); // right rail
    quad(box.m, -hw + t, hw - t, -hl, -hl + t); // front rail
    quad(box.m, -hw + t, hw - t, hl - t, hl); // rear rail
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Rubber-line strength along the lap: heavy rubber piling up in braking zones
 * and corner entries, a lighter polished look mid-corner. Multiplies the
 * texture alpha so the ribbon never exceeds LINE_ALPHA.
 */
function lineStrength(samples: Sample[], referenceSpeed: number, i: number): number {
  const n = samples.length;
  const s = samples[i];
  const ahead = samples[(i + 7) % n];
  const behind = samples[(i - 7 + n) % n];
  const braking = clamp01((s.speed - ahead.speed) / (referenceSpeed * 0.3));
  const accelerating = clamp01((behind.speed - s.speed) / (referenceSpeed * 0.3));
  const cornering = clamp01(Math.abs(s.curv) / 0.016);
  return clamp01(0.5 + 0.45 * braking + 0.18 * accelerating - 0.24 * cornering);
}

/** Circular arc gap in metres. */
function arcGap(length: number, a: number, b: number): number {
  const d = Math.abs(a - b) % length;
  return Math.min(d, length - d);
}

/** The tightest corners on the lap, well separated, for braking reference marks. */
function brakingSpots(track: Track): Sample[] {
  const samples = track.samples;
  const n = samples.length;
  const peaks: { arc: number; c: number }[] = [];
  for (let i = 0; i < n; i++) {
    const c = Math.abs(samples[i].curv);
    if (c < 0.01) continue;
    let top = true;
    for (let k = -7; k <= 7; k++) {
      if (Math.abs(samples[(i + k + n) % n].curv) > c) {
        top = false;
        break;
      }
    }
    if (top) peaks.push({ arc: samples[i].dist, c });
  }
  peaks.sort((a, b) => b.c - a.c);
  const chosen: { arc: number; c: number }[] = [];
  for (const p of peaks) {
    if (chosen.length >= 5) break;
    if (chosen.some((q) => arcGap(track.length, p.arc, q.arc) < 70)) continue;
    chosen.push(p);
  }
  const spots: Sample[] = [];
  for (const p of chosen) {
    // 18-30 m before the apex: the braking zone, not the corner itself.
    spots.push(sampleAt(track, p.arc - 18));
    spots.push(sampleAt(track, p.arc - 30));
  }
  return spots;
}

export function buildRoadSurfaces(track: Track, theme: TrackTheme): RoadSurfaces {
  // One seed per theme, so reloading or switching away and back rebuilds the
  // same asphalt, kerb paint and rubber line instead of a new random field.
  return withRoadSeed(roadTextureSeed(theme.kind, theme.citySeed), () => {
  const group = new THREE.Group();
  group.name = "road-surfaces";
  const samples = track.samples;
  const n = samples.length;
  const kind = theme.kind;
  const halfOf = (s: Sample): number => s.width * 0.5;

  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const texs: THREE.Texture[] = [];
  const own = <T>(list: T[], item: T): T => {
    list.push(item);
    return item;
  };

  // ---- textures (six in total) -------------------------------------------
  const asphalt = own(texs, asphaltMap(theme));
  const roughness = own(texs, asphaltRoughness());
  const barrier = own(texs, barrierTexture());
  const rubber = own(texs, racingLineTexture());
  const patch = own(texs, brakePatchTexture());

  // ---- materials ----------------------------------------------------------
  const roadMat = own(
    mats,
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: asphalt,
      roughnessMap: roughness,
      roughness: 0.94,
      metalness: 0.02,
      emissive: theme.roadEmissive,
      emissiveIntensity: theme.roadGlow,
      side: THREE.FrontSide,
    }),
  );
  const shellMat = own(
    mats,
    new THREE.MeshStandardMaterial({
      color: 0x24262a,
      map: asphalt,
      roughnessMap: roughness,
      roughness: 0.94,
      metalness: 0.02,
      emissive: theme.roadEmissive,
      emissiveIntensity: theme.roadGlow,
      side: THREE.FrontSide,
    }),
  );

  // Kerb stripes: theme.curbLight for the light band, the per-kind/side tint
  // used across this scene for the dark band (theme.curbDark as fallback).
  const darkTints: Partial<Record<TrackTheme["kind"], [string, string]>> = {
    city: ["#1a6d84", "#6e3a58"],
    yard: ["#8a5a2e", "#8a5a2e"],
    coast: ["#2c5c80", "#2c5c80"],
    core: ["#7a2e3c", "#2c5278"],
  };
  const tints = darkTints[kind];
  const darkLeft = (tints ? tints[0] : "") || theme.curbDark;
  const darkRight = (tints ? tints[1] : "") || theme.curbDark;
  const kerbTex = own(texs, curbTexture(theme.curbLight, darkLeft, theme.curbLight, darkRight));
  const kerbMat = own(
    mats,
    new THREE.MeshStandardMaterial({
      map: kerbTex,
      roughness: 0.74,
      metalness: 0.04,
      emissive: theme.curbEmissive,
      emissiveIntensity: Math.min(0.04, theme.curbGlow),
      side: THREE.FrontSide,
    }),
  );

  const wallMat = own(
    mats,
    new THREE.MeshStandardMaterial({
      color:
        kind === "yard"
          ? 3815476
          : kind === "coast"
            ? 4082258
            : kind === "core"
              ? 3287084
              : 3291200,
      map: barrier,
      roughness: 0.88,
      metalness: 0.08,
      side: THREE.FrontSide,
    }),
  );
  // The outer barrier is the one surface seen from both the racing line (through
  // the wall slot) and from outside the circuit. One winding cannot face both.
  const wallMatOuter = own(mats, wallMat.clone());
  wallMatOuter.side = THREE.DoubleSide;
  const capMats = [theme.barrierL, theme.barrierR].map((capColor) =>
    own(
      mats,
      new THREE.MeshStandardMaterial({
        color: 1448480,
        emissive: capColor,
        emissiveIntensity: 0.16,
        metalness: 0.55,
        roughness: 0.32,
        side: THREE.FrontSide,
      }),
    ),
  );
  const accentMats = [theme.edgeL, theme.edgeR].map((color) =>
    own(
      mats,
      new THREE.MeshStandardMaterial({
        color: 1184792,
        emissive: color,
        emissiveIntensity: 0.32,
        roughness: 0.42,
        metalness: 0.2,
        side: THREE.FrontSide,
      }),
    ),
  );
  const railMat = own(
    mats,
    new THREE.MeshStandardMaterial({
      color: 0x8d98a4,
      metalness: 0.72,
      roughness: 0.34,
      side: THREE.FrontSide,
    }),
  );
  const walkMat = own(
    mats,
    new THREE.MeshStandardMaterial({
      color: kind === "coast" ? 2763840 : kind === "yard" ? 2894376 : 2369584,
      roughness: 0.94,
      metalness: 0.02,
      side: THREE.FrontSide,
    }),
  );
  const lineMat = own(
    mats,
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: rubber,
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      roughness: 0.62,
      metalness: 0.06,
      side: THREE.FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    }),
  );
  const patchMat = own(
    mats,
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: patch,
      transparent: true,
      depthWrite: false,
      roughness: 0.66,
      metalness: 0.04,
      side: THREE.FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  const studMat = own(mats, new THREE.MeshBasicMaterial({ color: 16777215, toneMapped: true }));
  const gridMat = own(
    mats,
    new THREE.MeshStandardMaterial({
      color: gridPaint(theme),
      roughness: 0.55,
      metalness: 0.05,
      side: THREE.FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );

  // ---- deck, slab and skirts ---------------------------------------------
  const deckGeo = own(
    geos,
    faceUp(ribbon(
      loopStations(samples, track.length, ROAD_TILE, (s) => {
        const h = halfOf(s) + EDGE_PAD;
        return { a: at(s, -h, s.y + SURFACE), b: at(s, h, s.y + SURFACE) };
      }),
      false,
    )),
  );
  group.add(new THREE.Mesh(deckGeo, roadMat));

  const shellGeo = own(
    geos,
    faceDown(ribbon(
      loopStations(samples, track.length, ROAD_TILE, (s) => {
        const h = halfOf(s) + EDGE_PAD;
        const y = s.y + SURFACE - DECK;
        return { a: at(s, -h, y), b: at(s, h, y) };
      }),
      false,
    )),
  );
  group.add(new THREE.Mesh(shellGeo, shellMat));

  for (const sign of [-1, 1]) {
    const skirtGeo = own(
      geos,
      faceSign(ribbon(
        loopStations(samples, track.length, ROAD_TILE, (s) => {
          const lat = sign * (halfOf(s) + EDGE_PAD);
          return { a: at(s, lat, s.y + SURFACE), b: at(s, lat, s.y + SURFACE - DECK) };
        }),
        false,
      ), sign, samples[0]!),
    );
    group.add(new THREE.Mesh(skirtGeo, shellMat));
  }

  // ---- kerbs: only where the track actually turns -------------------------
  const { weights, runs } = kerbWeights(samples);
  // [side][face] -> one strip per corner run: face 0 is the vertical front,
  // face 1 the sloped top. Runs of a side/face merge into a single geometry, so
  // the lap costs four kerb meshes, not one per corner segment.
  const kerbStrips: Station[][][][] = [
    [[], []],
    [[], []],
  ];
  const kerbRunStarts: Sample[][] = [[], []];
  for (const run of runs) {
    const runStrips: Station[][][] = [
      [[], []],
      [[], []],
    ];
    let arc = 0;
    for (const i of run) {
      const s = samples[i];
      const w = weights[i];
      const front = KERB_FLOOR + w * (KERB_FRONT - KERB_FLOOR);
      const crown = KERB_FLOOR + w * (KERB_CROWN - KERB_FLOOR);
      const y0 = s.y + SURFACE;
      const v = arc / KERB_TILE;
      for (let side = 0; side < 2; side++) {
        const sign = side === 0 ? -1 : 1; // side 0 = left, like the old kerbs
        // Each side samples its own half of the shared kerb texture.
        const ua = side === 0 ? 0 : 0.5;
        const ub = side === 0 ? 0.5 : 1;
        const inner = sign * (halfOf(s) - KERB_W);
        const outer = sign * (halfOf(s) + KERB_OUT);
        runStrips[side][0].push(station(at(s, inner, y0), at(s, inner, y0 + front), v, ua, ub));
        runStrips[side][1].push(
          station(at(s, inner, y0 + front), at(s, outer, y0 + crown), v, ua, ub),
        );
      }
      arc += s.segLen;
    }
    for (let side = 0; side < 2; side++) {
      kerbStrips[side][0].push(runStrips[side][0]);
      kerbStrips[side][1].push(runStrips[side][1]);
      kerbRunStarts[side]!.push(samples[run[0]!]!);
    }
  }
  for (let side = 0; side < kerbStrips.length; side++) {
    const sign = side === 0 ? -1 : 1;
    const faces = kerbStrips[side]!;
    for (let faceI = 0; faceI < faces.length; faceI++) {
      const strips = faces[faceI]!;
      if (strips.length === 0) continue;
      const geo = own(geos, multiRibbon(strips));
      // Face 0 is the inner vertical front, seen from the racing line.
      // Face 1 is the sloped top.
      if (faceI === 0) faceSign(geo, -sign, kerbRunStarts[side]![0] ?? samples[0]!);
      else faceUp(geo);
      group.add(new THREE.Mesh(geo, kerbMat));
    }
  }

  // ---- barrier: double wall, cap, accent strip, walkway, rails ------------
  for (const sign of [-1, 1]) {
    const side = sign < 0 ? 0 : 1;
    for (const extra of [WALL_IN, WALL_OUT]) {
      const wallGeo = own(
        geos,
        ribbon(
          loopStations(samples, track.length, WALL_TILE, (s) => {
            const lat = sign * (halfOf(s) + extra);
            return { a: at(s, lat, s.y), b: at(s, lat, s.y + WALL_H) };
          }),
          false,
        ),
      );
      // Inner wall faces the road. Outer wall faces away; its material stays
      // DoubleSide because the slot between the two walls is visible from the
      // racing line and the outside face is visible past the circuit.
      if (extra === WALL_IN) faceSign(wallGeo, -sign, samples[0]!);
      else faceSign(wallGeo, sign, samples[0]!);
      const mat = extra === WALL_OUT ? wallMatOuter : wallMat;
      group.add(new THREE.Mesh(wallGeo, mat));
    }
    const topGeo = own(
      geos,
      faceUp(ribbon(
        loopStations(samples, track.length, WALL_TILE, (s) => ({
          a: at(s, sign * (halfOf(s) + WALL_IN), s.y + WALL_H),
          b: at(s, sign * (halfOf(s) + WALL_OUT), s.y + WALL_H + 0.02),
        })),
        false,
      )),
    );
    group.add(new THREE.Mesh(topGeo, wallMat));

    const capGeo = own(
      geos,
      faceUp(ribbon(
        loopStations(samples, track.length, WALL_TILE, (s) => ({
          a: at(s, sign * (halfOf(s) + WALL_IN), s.y + WALL_H),
          b: at(s, sign * (halfOf(s) + CAP_OUT), s.y + WALL_H + 0.1),
        })),
        false,
      )),
    );
    group.add(new THREE.Mesh(capGeo, capMats[side]));

    // Neon strip along the barrier face. The old strip floated at kerb height
    // across the road edge; riding the wall keeps it clear of the new kerbs and
    // visible on both sides of every circuit.
    const accentGeo = own(
      geos,
      faceSign(ribbon(
        loopStations(samples, track.length, WALL_TILE, (s) => {
          const lat = sign * (halfOf(s) + WALL_IN - 0.006);
          return { a: at(s, lat, s.y + 0.28), b: at(s, lat, s.y + 0.38) };
        }),
        false,
      ), -sign, samples[0]!),
    );
    group.add(new THREE.Mesh(accentGeo, accentMats[side]));

    const walkGeo = own(
      geos,
      faceUp(ribbon(
        loopStations(samples, track.length, 1, (s) => ({
          a: at(s, sign * (halfOf(s) + WALK_IN), s.y + WALK_Y),
          b: at(s, sign * (halfOf(s) + WALK_OUT), s.y + WALK_Y),
        })),
        false,
      )),
    );
    group.add(new THREE.Mesh(walkGeo, walkMat));

    for (const lift of [0, RAIL_LIFT]) {
      const railGeo = own(
        geos,
        faceSign(ribbon(
          loopStations(samples, track.length, 1, (s) => ({
            a: at(s, sign * (halfOf(s) + RAIL_INNER), s.y + RAIL_Y + lift),
            b: at(s, sign * (halfOf(s) + RAIL_INNER + RAIL_SPAN), s.y + RAIL_Y + RAIL_H + lift),
          })),
          false,
        ), -sign, samples[0]!),
      );
      group.add(new THREE.Mesh(railGeo, railMat));
    }
  }

  const dummy = new THREE.Object3D();

  // ---- guardrail posts: give the floating rails real support --------------
  const postMatrices: THREE.Matrix4[] = [];
  {
    let acc = POST_GAP * 0.4;
    for (const s of samples) {
      acc += s.segLen;
      if (acc < POST_GAP) continue;
      acc = 0;
      for (const sign of [-1, 1]) {
        const lat = sign * (halfOf(s) + POST_LAT);
        dummy.position.set(s.x + s.rx * lat, s.y + WALK_Y, s.z + s.rz * lat);
        dummy.rotation.set(0, Math.atan2(s.tx, s.tz), 0);
        dummy.scale.set(1, POST_H, 1);
        dummy.updateMatrix();
        postMatrices.push(dummy.matrix.clone());
      }
    }
  }
  const posts = new THREE.InstancedMesh(own(geos, postGeometry()), railMat, postMatrices.length);
  postMatrices.forEach((m, i) => posts.setMatrixAt(i, m));
  posts.frustumCulled = false;
  group.add(posts);

  // ---- reflective edge studs, on the kerb centreline (asphalt when weight is 0)
  const studMatrices: THREE.Matrix4[] = [];
  const studColors: THREE.Color[] = [];
  const studLift = new THREE.Vector3();
  const studRot = new THREE.Matrix4();
  for (let i = 0; i < n; i += STUD_EVERY) {
    const s = samples[i]!;
    const half = halfOf(s);
    const weight = weights[i] ?? 0;
    const slope = kerbCrossSlope(weight);
    for (const sign of [-1, 1]) {
      const lat = sign * kerbStudLat(half);
      // trackBasis +X is left. A right-hand kerb rises toward +right, so the
      // stud rolls the other way; the left kerb is the mirror. Bottom face
      // then lies on the surface instead of hovering in world-up.
      const basis = trackBasis(s).multiply(new THREE.Matrix4().makeRotationZ(sign > 0 ? -slope : slope));
      studRot.extractRotation(basis);
      studLift.set(0, STUD_H * 0.5, 0).applyMatrix4(studRot);
      dummy.position.set(s.x + s.rx * lat, s.y + SURFACE + kerbStudSurface(half, weight), s.z + s.rz * lat);
      dummy.position.add(studLift);
      dummy.quaternion.setFromRotationMatrix(basis);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      studMatrices.push(dummy.matrix.clone());
      studColors.push(new THREE.Color(sign < 0 ? theme.edgeL : theme.edgeR));
    }
  }
  const studs = new THREE.InstancedMesh(
    own(geos, new THREE.BoxGeometry(0.18, STUD_H, 0.42)),
    studMat,
    studMatrices.length,
  );
  studMatrices.forEach((m, i) => studs.setMatrixAt(i, m));
  studColors.forEach((c, i) => studs.setColorAt(i, c));
  if (studs.instanceColor) studs.instanceColor.needsUpdate = true;
  studs.frustumCulled = false;
  group.add(studs);

  // ---- rubbered-in racing line -------------------------------------------
  const linePlace = (s: Sample) => {
    const h = Math.min(1.5, Math.max(1, s.width * 0.09));
    const y = s.y + SURFACE + 0.012;
    return { a: at(s, s.line - h, y), b: at(s, s.line + h, y) };
  };
  const lineStations = loopStations(samples, track.length, LINE_TILE, linePlace);
  const lineGeo = own(geos, faceUp(ribbon(lineStations, false)));
  const lineColors = new Float32Array(lineStations.length * 4);
  for (let i = 0; i < lineStations.length; i++) {
    const strength = lineStrength(samples, track.referenceSpeed, i % n);
    lineColors[i * 4] = 1;
    lineColors[i * 4 + 1] = 1;
    lineColors[i * 4 + 2] = 1;
    lineColors[i * 4 + 3] = strength;
  }
  lineGeo.setAttribute("color", new THREE.BufferAttribute(lineColors, 4));
  group.add(new THREE.Mesh(lineGeo, lineMat));

  // ---- braking reference patches before the tightest corners --------------
  const spots = brakingSpots(track);
  if (spots.length > 0) {
    const patchGeo = own(geos, new THREE.PlaneGeometry(2.6, 5.2));
    patchGeo.rotateX(-Math.PI / 2);
    const patches = new THREE.InstancedMesh(patchGeo, patchMat, spots.length);
    spots.forEach((s, i) => {
      const m = trackBasis(s);
      m.setPosition(s.x + s.rx * s.line, s.y + SURFACE + 0.006, s.z + s.rz * s.line);
      m.scale(new THREE.Vector3(0.85 + (i % 3) * 0.14, 1, 0.9 + (i % 2) * 0.16));
      patches.setMatrixAt(i, m);
    });
    patches.frustumCulled = false;
    group.add(patches);
  }

  // ---- starting grid: two columns, two rows, from track.grid --------------
  const boxes: { m: THREE.Matrix4; w: number; l: number; t: number }[] = [];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
      const arc = track.length - track.grid.holdBack - row * track.grid.rowGap;
      const s = sampleAt(track, arc);
      const lat = col === 0 ? -track.grid.lat : track.grid.lat;
      const m = trackBasis(s);
      m.setPosition(s.x + s.rx * lat, s.y + SURFACE + 0.008, s.z + s.rz * lat);
      boxes.push({ m, w: 2.6, l: 5, t: 0.14 });
    }
  }
  group.add(new THREE.Mesh(own(geos, faceUp(gridBoxGeometry(boxes))), gridMat));

  return {
    group,
    dispose: () => {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const t of texs) t.dispose();
      geos.length = 0;
      mats.length = 0;
      texs.length = 0;
    },
  };
  });
}
