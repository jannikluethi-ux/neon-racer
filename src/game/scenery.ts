import * as THREE from "three";
import type { Sample, Track } from "./track";
import type { TrackTheme } from "./track-def";

/**
 * Visual dressing only. Nothing here is consulted by collision, AI, or timing.
 * Local +X is the driver's left (off the racing surface when |x| > half width).
 */

type Part = [number, number, number, number, number, number, number];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 1831565813) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function basisOf(s: Sample): THREE.Matrix4 {
  return new THREE.Matrix4().makeBasis(
    new THREE.Vector3(-s.rx, 0, -s.rz),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(s.tx, 0, s.tz),
  );
}

function centroid(track: Track): { x: number; y: number; z: number } {
  let x = 0;
  let y = 0;
  let z = 0;
  const n = track.samples.length || 1;
  for (const s of track.samples) {
    x += s.x;
    y += s.y;
    z += s.z;
  }
  return { x: x / n, y: y / n, z: z / n };
}

/** +1 if the driver's left points away from the infield. */
function outerSign(s: Sample, c: { x: number; z: number }): 1 | -1 {
  const dot = -s.rx * (c.x - s.x) + -s.rz * (c.z - s.z);
  return dot > 0 ? -1 : 1;
}

class Batch {
  private readonly lists: THREE.Matrix4[][];
  private readonly colors: THREE.Color[][];
  private readonly dummy = new THREE.Object3D();

  constructor(
    private readonly mats: THREE.Material[],
    private readonly tinted: boolean[],
  ) {
    this.lists = mats.map(() => []);
    this.colors = mats.map(() => []);
  }

  add(mat: number, px: number, py: number, pz: number, q: THREE.Quaternion, sx: number, sy: number, sz: number, color?: THREE.Color): void {
    if (mat < 0 || mat >= this.mats.length) return;
    if (sx <= 0 || sy <= 0 || sz <= 0) return;
    this.dummy.position.set(px, py, pz);
    this.dummy.quaternion.copy(q);
    this.dummy.scale.set(sx, sy, sz);
    this.dummy.updateMatrix();
    this.lists[mat].push(this.dummy.matrix.clone());
    if (this.tinted[mat]) this.colors[mat].push(color ?? new THREE.Color(0xffffff));
  }

  addLocal(mat: number, s: Sample, q: THREE.Quaternion, m: THREE.Matrix4, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, color?: THREE.Color): void {
    const p = new THREE.Vector3(lx, ly, lz).applyMatrix4(m);
    this.add(mat, s.x + p.x, s.y + p.y, s.z + p.z, q, sx, sy, sz, color);
  }

  flush(parent: THREE.Object3D, geo: THREE.BufferGeometry): void {
    for (let i = 0; i < this.mats.length; i++) {
      const list = this.lists[i];
      if (!list || list.length === 0) continue;
      const mesh = new THREE.InstancedMesh(geo, this.mats[i], list.length);
      for (let j = 0; j < list.length; j++) mesh.setMatrixAt(j, list[j]!);
      if (this.tinted[i]) {
        const cols = this.colors[i]!;
        for (let j = 0; j < list.length; j++) mesh.setColorAt(j, cols[j] ?? new THREE.Color(0xffffff));
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      parent.add(mesh);
    }
  }
}

function std(color: number, rough: number, metal: number, emissive = 0x000000, intensity = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: rough,
    metalness: metal,
    emissive,
    emissiveIntensity: intensity,
  });
}

function lit(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, toneMapped: true });
}

function each(samples: Sample[], spacing: number, jitter: number, rng: () => number, fn: (s: Sample) => void): void {
  let acc = spacing * 0.35;
  let next = spacing;
  for (const s of samples) {
    acc += s.segLen;
    if (acc < next) continue;
    acc = 0;
    next = spacing + rng() * jitter;
    fn(s);
  }
}

function tower(w: number, d: number, h: number, bright: boolean): Part[] {
  const parts: Part[] = [
    [0, 0.45, 0, w + 3.4, 0.9, d + 2.6, 3],
    [0, 2.1, 0, w + 0.8, 2.4, d + 0.4, 0],
    [0, 2.4 + (h - 4) * 0.5, 0, w * 0.92, h - 4.2, d * 0.9, 8],
    [w * 0.5, h * 0.5, d * 0.48, 0.55, h * 0.92, 0.55, 1],
    [-w * 0.5, h * 0.5, d * 0.48, 0.55, h * 0.92, 0.55, 1],
    [w * 0.5, h * 0.5, -d * 0.48, 0.55, h * 0.92, 0.55, 1],
    [-w * 0.5, h * 0.5, -d * 0.48, 0.55, h * 0.92, 0.55, 1],
    [0, h + 1.1, 0, w * 0.55, 2.2, d * 0.55, 1],
    [w * 0.16, h + 2.8, 0, w * 0.28, 1.5, d * 0.32, 1],
    [0, h + 5.2, 0, 0.16, 3.6, 0.16, 1],
  ];
  const y = h * 0.62;
  parts.push([0, y, d * 0.5 + 0.1, w * 0.7, 0.7, 0.1, bright ? 4 : 5]);
  return parts;
}

function glassTower(w: number, d: number, h: number): Part[] {
  return [
    [0, 0.4, 0, w + 2.8, 0.8, d + 2.2, 3],
    [0, h * 0.48, 0, w * 0.88, h * 0.82, d * 0.86, 7],
    [0, h * 0.22, 0, w + 1.6, 0.42, d + 1.2, 1],
    [0, h * 0.58, 0, w + 1.15, 0.32, d + 0.85, 1],
    [w * 0.58, h * 0.4, 0, 1.6, 0.18, d * 0.62, 3],
    [-w * 0.56, h * 0.7, 0, 1.5, 0.18, d * 0.5, 3],
    [0, h * 0.9, 0, w * 0.62, 0.7, d * 0.62, 1],
    [0, h + 1.8, 0, w * 0.34, 2.8, d * 0.34, 1],
    [0, h + 4.4, 0, 0.18, 3.2, 0.18, 1],
    [0, h * 0.48, d * 0.5 + 0.08, w * 0.36, 1.1, 0.08, 4],
  ];
}

function slab(w: number, d: number, h: number, bright: boolean): Part[] {
  return [
    [0, 0.35, 0, w + 1.8, 0.7, d + 1.4, 3],
    [0, h * 0.5, 0, w, h, d, 9],
    [w * 0.3, h * 0.5, d * 0.5 + 0.45, 0.32, h * 0.86, 0.7, 1],
    [-w * 0.3, h * 0.5, d * 0.5 + 0.45, 0.32, h * 0.86, 0.7, 1],
    [0, h * 0.5, d * 0.5 + 0.28, w * 0.28, h * 0.62, 0.36, 8],
    [0, h + 0.7, 0, w * 0.42, 1.15, d * 0.38, 1],
    [-w * 0.28, h + 0.65, 0, 1.1, 0.9, 1.1, 1],
    [w * 0.32, h + 1.8, 0, 0.12, 2.4, 0.12, 1],
    [0, h * 0.72, d * 0.5 + 0.08, w * 0.55, 0.45, 0.08, bright ? 4 : 5],
  ];
}

function warehouse(w: number, d: number, h: number): Part[] {
  return [
    [0, h * 0.42, 0, w, h * 0.84, d, 10],
    [0, h * 0.9, 0, w * 0.98, 0.4, d * 0.96, 1],
    [-w * 0.22, h + 0.85, 0, w * 0.3, 1.35, d * 0.72, 10],
    [w * 0.2, h + 0.6, 0.6, w * 0.26, 1.05, d * 0.5, 10],
    [0, 1.35, d * 0.5 + 0.08, w * 0.22, 2.3, 0.1, 3],
    [-w * 0.32, 1.2, d * 0.5 + 0.1, 1.05, 2.15, 0.1, 3],
    [w * 0.5 + 0.4, h * 0.45, 0, 0.55, 0.55, d * 0.85, 1],
    [w * 0.5 + 0.4, 0.45, 0, 0.7, 0.9, 0.7, 3],
  ];
}

function stepped(w: number, d: number, h: number): Part[] {
  return [
    [0, 0.3, 0, w + 2.2, 0.6, d + 1.6, 3],
    [0, h * 0.18, 0, w, h * 0.36, d, 7],
    [w * 0.1, h * 0.46, 0, w * 0.64, h * 0.26, d * 0.7, 9],
    [-w * 0.08, h * 0.66, 0, w * 0.36, h * 0.16, d * 0.42, 8],
    [0, h * 0.82, 0, w * 0.18, h * 0.12, d * 0.2, 1],
    [w * 0.16, h * 0.94, 0, 0.16, h * 0.14, 0.16, 1],
    [w * 0.22, h * 0.38, d * 0.15, w * 0.16, 1.3, w * 0.16, 1],
    [0, h * 0.22, d * 0.5 + 0.08, w * 0.48, 0.5, 0.08, 4],
  ];
}

function wedge(w: number, d: number, h: number): Part[] {
  return [
    [0, 0.28, 0, w + 1.6, 0.55, d + 1.2, 3],
    [-w * 0.06, h * 0.32, 0, w * 0.86, h * 0.64, d, 9],
    [w * 0.28, h * 0.62, 0, w * 0.34, h * 0.5, d * 0.62, 7],
    [0, 1.15, d * 0.55, w * 0.72, 0.14, 1.3, 1],
    [-w * 0.22, 1.15, d * 0.5 + 0.08, 0.9, 2.05, 0.08, 3],
    [0, h * 0.4, d * 0.5 + 0.08, w * 0.4, 0.4, 0.08, 4],
  ];
}

/** Tall narrow landmark. Reads as a spire, not a scaled cube. */
function needle(w: number, d: number, h: number): Part[] {
  return [
    [0, 0.4, 0, w + 4.5, 0.8, d + 4.5, 3],
    [0, h * 0.16, 0, w * 1.15, h * 0.32, d * 1.1, 0],
    [0, h * 0.48, 0, w * 0.48, h * 0.36, d * 0.48, 8],
    [0, h * 0.72, 0, w * 0.26, h * 0.14, d * 0.26, 1],
    [0, h * 0.84, 0, w * 0.14, h * 0.1, d * 0.14, 7],
    [0, h * 0.98, 0, 0.35, h * 0.2, 0.35, 1],
    [0, h * 1.12, 0, 0.7, 0.7, 0.7, 5],
    [0, h * 0.4, d * 0.28, w * 0.2, 0.55, 0.08, 4],
  ];
}

/** Twin shafts and a skybridge. One per skyline, not a repeated block. */
function landmark(w: number, h: number, skin: number): Part[] {
  const gap = w * 0.72;
  return [
    [0, 0.7, 0, w * 2.3, 1.4, w * 0.85, 3],
    [-gap, h * 0.4, 0, w * 0.46, h * 0.8, w * 0.4, skin],
    [gap * 0.92, h * 0.34, 0, w * 0.38, h * 0.68, w * 0.34, skin === 7 ? 8 : 7],
    [0, h * 0.58, 0, gap * 1.55, h * 0.045, w * 0.18, 1],
    [-gap, h * 0.86, 0, w * 0.22, h * 0.08, w * 0.2, 1],
    [-gap, h * 0.98, 0, 0.22, h * 0.16, 0.22, 1],
    [gap * 0.92, h * 0.74, 0, w * 0.24, 1.2, w * 0.22, 1],
    [0, h * 0.58, w * 0.12, gap * 0.7, 0.12, 0.08, 4],
  ];
}

function facadeTex(mode: "band" | "vert" | "cluster" | "works"): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d");
  if (g) {
    if (mode === "works") {
      g.fillStyle = "#6a5c50";
      g.fillRect(0, 0, 64, 64);
      g.fillStyle = "#241c16";
      g.fillRect(4, 8, 22, 16);
      g.fillStyle = "#ffc56a";
      g.fillRect(4, 36, 34, 16);
      g.fillStyle = "#ff9a3c";
      g.fillRect(42, 10, 16, 14);
      g.fillStyle = "#d8d2c8";
      g.fillRect(0, 60, 64, 3);
    } else if (mode === "vert") {
      g.fillStyle = "#4a6074";
      g.fillRect(0, 0, 64, 64);
      g.fillStyle = "#1a2834";
      g.fillRect(0, 0, 8, 64);
      g.fillRect(56, 0, 8, 64);
      g.fillStyle = "#f4fbff";
      g.fillRect(14, 4, 12, 56);
      g.fillStyle = "#7eb8d4";
      g.fillRect(32, 4, 8, 56);
      g.fillStyle = "#163044";
      g.fillRect(44, 4, 8, 56);
    } else if (mode === "cluster") {
      g.fillStyle = "#3d5164";
      g.fillRect(0, 0, 64, 64);
      const cells: Array<[number, number, string]> = [
        [4, 4, "#f7fbff"],
        [22, 6, "#8ec4de"],
        [40, 4, "#1a3040"],
        [6, 26, "#e7f4fb"],
        [24, 28, "#204058"],
        [42, 24, "#b7e0f4"],
        [8, 46, "#f2f7fb"],
        [28, 44, "#6aa4c0"],
      ];
      for (const [x, y, color] of cells) {
        g.fillStyle = color;
        g.fillRect(x, y, 16, 14);
      }
    } else {
      g.fillStyle = "#3e5366";
      g.fillRect(0, 0, 64, 64);
      g.fillStyle = "#102030";
      g.fillRect(0, 40, 64, 24);
      for (let x = 3; x < 64; x += 15) {
        g.fillStyle = x % 30 === 3 ? "#f5fbff" : "#7ec0dc";
        g.fillRect(x, 44, 10, 14);
      }
      g.fillStyle = "#d5e8f4";
      g.fillRect(0, 38, 64, 3);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function facadeMat(map: THREE.Texture, glow: number): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map,
    emissive: 0xffffff,
    emissiveMap: map,
    emissiveIntensity: glow,
    roughness: 0.62,
    metalness: 0.06,
  });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <uv_vertex>",
      `#include <uv_vertex>
#ifdef USE_INSTANCING
{
  float nrW = max(length(instanceMatrix[0].xyz), length(instanceMatrix[2].xyz));
  float nrH = length(instanceMatrix[1].xyz);
  #ifdef USE_MAP
    vMapUv *= vec2(nrW / 4.6, nrH / 4.2);
  #endif
  #ifdef USE_EMISSIVEMAP
    vEmissiveMapUv *= vec2(nrW / 4.6, nrH / 4.2);
  #endif
}
#endif`,
    );
  };
  return mat;
}

function windowColor(kind: string, rng: () => number): THREE.Color {
  const roll = rng();
  if (kind === "yard") {
    if (roll < 0.55) return new THREE.Color(0x2a2118);
    if (roll < 0.82) return new THREE.Color(0xffb15a);
    return new THREE.Color(0xffe2b0);
  }
  if (kind === "core") {
    if (roll < 0.62) return new THREE.Color(0x241c20);
    if (roll < 0.82) return new THREE.Color(0xff445f);
    return new THREE.Color(0x7eb6ff);
  }
  if (kind === "coast") {
    if (roll < 0.7) return new THREE.Color(0x163044);
    return new THREE.Color(0xc5e4ff);
  }
  if (roll < 0.46) return new THREE.Color(0x121a22);
  if (roll < 0.7) return new THREE.Color(0x3d5a70);
  if (roll < 0.88) return new THREE.Color(0xd5e6f2);
  if (roll < 0.96) return new THREE.Color(0xffe2b8);
  return new THREE.Color(0x7ad7ea);
}

function placeKit(
  boxes: Batch,
  s: Sample,
  q: THREE.Quaternion,
  m: THREE.Matrix4,
  sign: number,
  gap: number,
  parts: Part[],
  footprint: number,
  kind: string,
  rng: () => number,
  yBase: number,
): void {
  const reach = s.width * 0.5 + gap + footprint * 0.5;
  const lx0 = sign * reach;
  for (const part of parts) {
    const color = part[6] === 4 ? windowColor(kind, rng) : undefined;
    const p = new THREE.Vector3(lx0 + part[0], part[1] + yBase, part[2]).applyMatrix4(m);
    boxes.add(part[6], s.x + p.x, s.y + p.y, s.z + p.z, q, part[3], part[4], part[5], color);
  }
}

function lampAt(boxes: Batch, s: Sample, q: THREE.Quaternion, m: THREE.Matrix4, side: number, glow: THREE.Color, arm = 1): void {
  const dist = s.width * 0.5 + 3.35;
  const lx = side * dist;
  const reach = 1.35 + arm * 0.85;
  const pole = 6.2 + arm * 1.35;
  boxes.addLocal(3, s, q, m, lx, 0.18, 0, 0.72, 0.28, 0.72);
  boxes.addLocal(1, s, q, m, lx, pole * 0.36, 0, 0.28, pole * 0.72, 0.28);
  boxes.addLocal(1, s, q, m, lx, pole * 0.78, 0, 0.16, pole * 0.28, 0.16);
  boxes.addLocal(1, s, q, m, side * (dist - reach * 0.55), pole - 0.15, 0, reach, 0.12, 0.16);
  boxes.addLocal(1, s, q, m, side * (dist - reach), pole - 0.42, 0, 1.15, 0.32, 0.62);
  boxes.addLocal(4, s, q, m, side * (dist - reach), pole - 0.64, 0, 0.72, 0.08, 0.36, glow);
}

function furniture(boxes: Batch, track: Track, kind: string, rng: () => number): void {
  const glowL = kind === "yard" ? new THREE.Color(0xffc58a) : kind === "core" ? new THREE.Color(0xff6a7a) : new THREE.Color(0xe7f6ff);
  const glowR = kind === "yard" ? new THREE.Color(0xffe2b0) : kind === "core" ? new THREE.Color(0x8ec8ff) : kind === "coast" ? new THREE.Color(0xd7ecff) : new THREE.Color(0xffd6ea);
  each(track.samples, kind === "coast" ? 52 : 44, 16, rng, (s) => {
    if (kind === "yard" && s.y < 0.5) return;
    if (kind === "core" && s.y <= 2.05) return;
    const m = basisOf(s);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    const arm = 0.7 + rng() * 0.7;
    lampAt(boxes, s, q, m, 1, glowL, arm);
    if (rng() > 0.42) lampAt(boxes, s, q, m, -1, glowR, 0.6 + rng() * 0.8);
  });
  each(track.samples, 42, 12, rng, (s) => {
    if (rng() > 0.65) return;
    const m = basisOf(s);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    const side = rng() > 0.5 ? 1 : -1;
    const lx = side * (s.width * 0.5 + 1.35);
    boxes.addLocal(1, s, q, m, lx, 0.48, 0, 0.12, 0.96, 0.12);
    boxes.addLocal(5, s, q, m, lx, 0.98, 0, 0.16, 0.06, 0.16);
  });
  each(track.samples, 90, 24, rng, (s) => {
    if (Math.abs(s.curv) > 0.012) return;
    const m = basisOf(s);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    const side = rng() > 0.5 ? 1 : -1;
    const lx = side * (s.width * 0.5 + 2.15);
    boxes.addLocal(3, s, q, m, lx, 0.65, 0, 0.7, 1.25, 0.42);
    boxes.addLocal(5, s, q, m, lx, 1.15, 0.22, 0.22, 0.08, 0.08);
  });
  let boards = 0;
  each(track.samples, 16, 0, rng, (s) => {
    if (boards >= 16 || Math.abs(s.curv) < 0.008) return;
    const m = basisOf(s);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    const side = s.curv >= 0 ? 1 : -1;
    const lx = side * (s.width * 0.5 + 1.45);
    const mat = boards % 3 === 0 ? 5 : 3;
    boxes.addLocal(1, s, q, m, lx, 0.7, 0, 0.08, 1.4, 0.08);
    boxes.addLocal(mat, s, q, m, lx, 1.7, 0, 0.08, 0.7, 1.2);
    boards++;
  });
}

function spotOf(s: Sample, sign: number, gap: number): THREE.Vector3 {
  const reach = s.width * 0.5 + gap;
  return new THREE.Vector3(s.x - s.rx * sign * reach, s.y, s.z - s.rz * sign * reach);
}

function tooClose(seen: THREE.Vector3[], spot: THREE.Vector3, dist: number): boolean {
  for (const p of seen) if (p.distanceTo(spot) < dist) return true;
  return false;
}

function advance(s: Sample, along: number): Sample {
  return { ...s, x: s.x + s.tx * along, z: s.z + s.tz * along };
}

function straightOf(track: Track, anchorZ: number): Sample {
  let best = track.samples[0]!;
  let score = 1e9;
  for (const s of track.samples) {
    const v = Math.abs(s.z - anchorZ) + Math.abs(s.curv) * 800;
    if (v < score) {
      score = v;
      best = s;
    }
  }
  return best;
}

function populateCity(boxes: Batch, track: Track, theme: TrackTheme, rng: () => number): void {
  const c = centroid(track);
  const seen: THREE.Vector3[] = [];
  each(track.samples, 48, 18, rng, (s) => {
    const m = basisOf(s);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    const curv = Math.abs(s.curv);
    const layers = curv < 0.005 ? [16, 36, 64] : curv > 0.016 ? [18] : [18, 42];
    for (const side of [1, -1] as const) {
      const outer = side === outerSign(s, c);
      if (!outer && curv > 0.01) continue;
      for (const gap0 of layers) {
        if (!outer && gap0 > 28) continue;
        if (rng() > (gap0 > 50 ? 0.7 : 0.88)) continue;
        const gap = gap0 + rng() * 6;
        const spot = spotOf(s, side, gap);
        if (tooClose(seen, spot, gap0 > 50 ? 30 : 18)) continue;
        seen.push(spot);
        const roll = rng();
        let parts: Part[];
        let foot: number;
        if (gap0 > 50) {
          const w = 9 + rng() * 6;
          const h = 46 + rng() * 50;
          parts = roll > 0.45 ? needle(w * 0.7, w * 0.55, h) : stepped(w, w * 0.8, h * 0.7);
          foot = w;
        } else if (roll > 0.58 && outer) {
          const w = 8 + rng() * 4;
          const h = 32 + rng() * 40;
          parts = roll > 0.8 ? needle(w, w * 0.8, h) : glassTower(w, w * 0.85, h);
          foot = w;
        } else if (roll > 0.3) {
          const w = 12 + rng() * 7;
          const h = 14 + rng() * 18;
          parts = roll > 0.5 ? stepped(w, w * 0.72, h) : slab(w, w * 0.7, h, rng() > 0.4);
          foot = w;
        } else {
          const w = 14 + rng() * 6;
          parts = warehouse(w, 10 + rng() * 4, 6 + rng() * 5);
          foot = w;
        }
        placeKit(boxes, s, q, m, side, gap, parts, foot, "city", rng, 0);
      }
    }
  });
  const far: THREE.Vector3[] = [];
  each(track.samples, 90, 30, rng, (s) => {
    const sign = outerSign(s, c);
    const gap = 110 + rng() * 80;
    const spot = spotOf(s, sign, gap);
    if (tooClose(far, spot, 48)) return;
    far.push(spot);
    const h = 70 + rng() * 80;
    const w = 10 + rng() * 8;
    const m = basisOf(s);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    const roll = rng();
    const parts: Part[] = roll > 0.66
      ? [
          [0, h * 0.42, 0, w * 0.42, h * 0.84, w * 0.36, 6],
          [0, h * 0.9, 0, w * 0.22, h * 0.12, w * 0.2, 6],
          [0, h + 6, 0, 0.6, 12, 0.6, 6],
          [0, h * 0.5, 0, w * 0.16, 0.4, 0.08, 4],
        ]
      : roll > 0.33
        ? [
            [0, h * 0.22, 0, w, h * 0.44, w * 0.75, 6],
            [0, h * 0.58, 0, w * 0.6, h * 0.28, w * 0.48, 6],
            [0, h * 0.8, 0, w * 0.32, h * 0.14, w * 0.26, 6],
            [0, h * 0.45, 0, w * 0.3, 0.35, 0.08, 4],
          ]
        : [
            [0, h * 0.4, 0, w, h * 0.8, w * 0.7, 6],
            [0, h * 0.86, 0, w * 0.7, h * 0.1, w * 0.55, 6],
            [w * 0.2, h + 2, 0, w * 0.18, 4, w * 0.18, 6],
          ];
    placeKit(boxes, s, q, m, sign, gap, parts, w, "city", rng, 0);
  });

  const straight = (() => {
    let best = track.samples[0]!;
    let score = 1e9;
    for (const s of track.samples) {
      const v = Math.abs(s.z - theme.straightAnchorZ) + Math.abs(s.curv) * 800;
      if (v < score) {
        score = v;
        best = s;
      }
    }
    return best;
  })();
  const sm = basisOf(straight);
  const sq = new THREE.Quaternion().setFromRotationMatrix(sm);
  const sSign = outerSign(straight, c);
  const hero = [78, 112, 64, 96];
  hero.forEach((h, i) => {
    const shifted = advance(straight, (i - 1.5) * 42);
    const gap = 16 + (i % 2) * 6;
    const kit = i === 1 ? landmark(12, h, 7) : i === 3 ? needle(9, 8, h) : i === 0 ? glassTower(11, 10, h) : tower(10, 9, h, true);
    placeKit(boxes, shifted, sq, sm, sSign, gap, kit, 18, "city", rng, 0);
    placeKit(boxes, shifted, sq, sm, -sSign as 1 | -1, 18, slab(15, 11, 20 + (i % 3) * 5, true), 15, "city", rng, 0);
  });
  const beacon = advance(straight, 210);
  const bm = basisOf(beacon);
  const bq = new THREE.Quaternion().setFromRotationMatrix(bm);
  const bSign = outerSign(beacon, c);
  placeKit(boxes, beacon, bq, bm, bSign, 22, landmark(14, 132, 8), 20, "city", rng, 0);
  placeKit(boxes, advance(beacon, -48), bq, bm, bSign, 18, glassTower(11, 10, 84), 14, "city", rng, 0);
  placeKit(boxes, advance(beacon, 46), bq, bm, bSign, 24, stepped(18, 13, 58), 18, "city", rng, 0);

  let sweeper = track.samples[0]!;
  for (const s of track.samples) if (s.curv < sweeper.curv) sweeper = s;
  const wm = basisOf(sweeper);
  const wq = new THREE.Quaternion().setFromRotationMatrix(wm);
  const span = sweeper.width + 8;
  boxes.addLocal(1, sweeper, wq, wm, span * 0.5 - 1.5, 4.4, 0, 0.55, 8.8, 0.55);
  boxes.addLocal(1, sweeper, wq, wm, -(span * 0.5 - 1.5), 4.4, 0, 0.55, 8.8, 0.55);
  boxes.addLocal(1, sweeper, wq, wm, 0, 8.55, 0, span, 0.42, 3.2);
  boxes.addLocal(3, sweeper, wq, wm, 0, 8.9, 0, span * 0.92, 0.16, 3.4);
  boxes.addLocal(5, sweeper, wq, wm, 0, 8.35, 0.4, span * 0.55, 0.05, 0.16);
  const deck = outerSign(sweeper, c);
  for (let i = -2; i <= 2; i++) {
    const shifted = advance(sweeper, i * 22);
    const kit = i === 0 ? needle(8, 7, 64) : i % 2 === 0 ? glassTower(10, 8, 36) : slab(12, 9, 18, true);
    placeKit(boxes, shifted, wq, wm, deck, i === 0 ? 26 : 16, kit, 12, "city", rng, 0);
  }

  let chicane = track.samples[0]!;
  for (const s of track.samples) if (s.curv > chicane.curv) chicane = s;
  const cm = basisOf(chicane);
  const cq = new THREE.Quaternion().setFromRotationMatrix(cm);
  const cSide = chicane.curv >= 0 ? 1 : -1;
  for (let i = -2; i <= 2; i++) {
    const shifted = advance(chicane, i * 12);
    const lx = cSide * (shifted.width * 0.5 + 1.7);
    boxes.addLocal(5, shifted, cq, cm, lx, 1.45, 0, 0.12, 0.9, 1.6);
    boxes.addLocal(1, shifted, cq, cm, lx, 0.55, 0, 0.14, 1.15, 0.14);
    if (i !== 0) placeKit(boxes, shifted, cq, cm, (i > 0 ? cSide : -cSide) as 1 | -1, 9, wedge(9, 7, 8 + Math.abs(i)), 9, "city", rng, 0);
  }
  placeKit(boxes, chicane, cq, cm, cSide, 12, warehouse(11, 8, 7), 11, "city", rng, 0);

  let parked = 0;
  each(track.samples, 52, 16, rng, (s) => {
    if (parked > 22 || Math.abs(s.curv) > 0.004) return;
    const pm = basisOf(s);
    const pq = new THREE.Quaternion().setFromRotationMatrix(pm);
    const side = outerSign(s, c);
    const lx = side * (s.width * 0.5 + 5.6);
    boxes.addLocal(rng() > 0.5 ? 0 : 3, s, pq, pm, lx, 0.42, 0, 1.65, 0.62, 3.8);
    boxes.addLocal(2, s, pq, pm, lx, 0.86, -0.2, 1.35, 0.4, 1.5);
    parked++;
  });
}

function populateYard(boxes: Batch, cyl: Batch, track: Track, rng: () => number): void {
  const c = centroid(track);
  const ground = track.minY;
  each(track.samples, 16, 4, rng, (s) => {
    const drop = s.y - ground;
    if (drop < 2.3) return;
    const m = basisOf(s);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    for (const side of [1, -1]) {
      const lx = side * (s.width * 0.5 + 2.85);
      const p = new THREE.Vector3(lx, 0, 0).applyMatrix4(m);
      const h = Math.max(2.2, drop);
      boxes.add(0, s.x + p.x, ground + h * 0.5, s.z + p.z, q, 1.15, h, 1.15);
      boxes.add(1, s.x + p.x, ground + h - 0.25, s.z + p.z, q, 2.1, 0.38, 2.1);
      boxes.addLocal(1, s, q, m, lx, -0.55, 0, 0.55, 0.42, 14);
    }
    boxes.addLocal(1, s, q, m, 0, -1.15, 0, s.width + 5.2, 0.42, 0.85);
    if (rng() > 0.55) boxes.addLocal(1, s, q, m, 0, -drop * 0.45, 0, s.width + 5.4, 0.22, 0.28);
    if (rng() > 0.7) {
      const side = outerSign(s, c);
      boxes.addLocal(1, s, q, m, side * (s.width * 0.5 + 4.6), -1.7, 0, 1.05, 0.12, 10);
    }
  });
  let braces = 0;
  each(track.samples, 28, 6, rng, (s) => {
    if (braces >= 22) return;
    const drop = s.y - ground;
    if (drop < 3.4) return;
    const m = basisOf(s);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    const span = s.width + 5.7;
    const rise = drop * 0.7;
    const ang = Math.atan2(rise, span) * (braces % 2 === 0 ? 1 : -1);
    const local = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ang);
    const wq = q.clone().multiply(local);
    const len = Math.hypot(span, rise);
    const p = new THREE.Vector3(0, -drop * 0.38, 0).applyMatrix4(m);
    boxes.add(1, s.x + p.x, s.y + p.y, s.z + p.z, wq, len, 0.18, 0.18);
    braces++;
  });
  const yardStraight = straightOf(track, 0);
  const ysm = basisOf(yardStraight);
  const ysq = new THREE.Quaternion().setFromRotationMatrix(ysm);
  const ySign = outerSign(yardStraight, c);
  const yBase = ground - yardStraight.y;
  for (let i = 0; i < 3; i++) {
    const shifted = advance(yardStraight, 18 + i * 16);
    const reach = shifted.width * 0.5 + 18;
    const p = new THREE.Vector3(ySign * reach, yBase + 4.5, 0).applyMatrix4(ysm);
    cyl.add(0, shifted.x + p.x, shifted.y + p.y, shifted.z + p.z, ysq, 5.5, 9, 5.5);
    boxes.add(5, shifted.x + p.x, ground + 9.3, shifted.z + p.z, ysq, 2.2, 0.35, 2.2);
  }
  placeKit(boxes, advance(yardStraight, 36), ysq, ysm, ySign, 14, warehouse(16, 10, 6), 16, "yard", rng, yBase);
  each(track.samples, 42, 16, rng, (s) => {
    const sign = rng() > 0.3 ? outerSign(s, c) : (-outerSign(s, c) as 1 | -1);
    const gap = 12 + rng() * 10 + (Math.abs(s.curv) > 0.015 ? 5 : 0);
    const w = 10 + rng() * 14;
    const d = 8 + rng() * 10;
    const h = 5 + rng() * 7;
    const m = basisOf(s);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    const yBase = ground - s.y;
    if (rng() > 0.62) {
      const reach = s.width * 0.5 + gap + 3;
      const p = new THREE.Vector3(sign * reach, yBase + h * 0.5, 0).applyMatrix4(m);
      cyl.add(0, s.x + p.x, s.y + p.y, s.z + p.z, q, 4.2 + rng() * 2, h, 4.2 + rng());
      boxes.add(5, s.x + p.x, ground + h + 0.2, s.z + p.z, q, 1.4, 0.25, 1.4);
      return;
    }
    placeKit(boxes, s, q, m, sign, gap, warehouse(w, d, h), Math.max(w, d) * 0.5, "yard", rng, yBase);
  });
  // Containers and a crane beside the crest, off the deck.
  let crest = track.samples[0]!;
  for (const s of track.samples) if (s.y > crest.y) crest = s;
  const cm = basisOf(crest);
  const cq = new THREE.Quaternion().setFromRotationMatrix(cm);
  const sign = outerSign(crest, c);
  for (let i = 0; i < 4; i++) {
    const along = -18 + i * 7;
    const shifted = { ...crest, x: crest.x + crest.tx * along, z: crest.z + crest.tz * along };
    placeKit(boxes, shifted, cq, cm, sign, 14, [[0, 1.3, 0, 2.4, 2.5, 6.2, i % 2 === 0 ? 3 : 0]], 6.2, "yard", rng, ground - crest.y);
  }
  const mastX = sign * (crest.width * 0.5 + 18);
  boxes.addLocal(1, crest, cq, cm, mastX, ground - crest.y + 14, 8, 0.7, 28, 0.7);
  boxes.addLocal(1, crest, cq, cm, mastX - sign * 8, ground - crest.y + 26, 8, 16, 0.35, 0.45);
  boxes.addLocal(5, crest, cq, cm, mastX, ground - crest.y + 27.2, 8, 0.8, 0.8, 0.8);
  // Keep the yard tower on the right shoulder (local -X), clear of the road.
  boxes.addLocal(1, crest, cq, cm, -(crest.width * 0.5 + 16), 8, 0, 6.5, 26, 6.5);
  boxes.addLocal(5, crest, cq, cm, -(crest.width * 0.5 + 16), 18, 0, 7, 0.4, 7);
  // Distant industrial silhouettes, then a utility run along the elevated shoulder.
  each(track.samples, 86, 18, rng, (s) => {
    const o = outerSign(s, c);
    const m = basisOf(s);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    const h = 16 + rng() * 24;
    placeKit(boxes, s, q, m, o, 52 + rng() * 28, [
      [0, h * 0.5, 0, 16, h, 11, 6],
      [0, h * 0.7, 0, 4, 0.3, 0.1, 4],
    ], 16, "yard", rng, ground - s.y);
  });
  each(track.samples, 14, 0, rng, (s) => {
    if (s.y - ground < 2.4) return;
    const m = basisOf(s);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    const side = outerSign(s, c);
    boxes.addLocal(1, s, q, m, side * (s.width * 0.5 + 5.2), 2.8, 0, 0.07, 0.07, 15);
    if (rng() > 0.72) {
      const drop = s.y - ground;
      boxes.addLocal(1, s, q, m, side * (s.width * 0.5 + 5.2), -drop * 0.5 + 1.4, 0, 0.08, Math.max(2, drop - 1), 0.08);
    }
  });
  let hairpin = track.samples[0]!;
  for (const s of track.samples) if (Math.abs(s.curv) > Math.abs(hairpin.curv)) hairpin = s;
  const hm = basisOf(hairpin);
  const hq = new THREE.Quaternion().setFromRotationMatrix(hm);
  const hSide = hairpin.curv >= 0 ? 1 : -1;
  placeKit(boxes, hairpin, hq, hm, hSide, 11, warehouse(12, 8, 7), 12, "yard", rng, ground - hairpin.y);
  for (let i = -1; i <= 1; i++) {
    const shifted = advance(hairpin, i * 12);
    boxes.addLocal(5, shifted, hq, hm, hSide * (shifted.width * 0.5 + 1.6), 1.45, 0, 0.1, 0.8, 1.35);
  }
}

function populateCoast(parent: THREE.Object3D, boxes: Batch, cyl: Batch, track: Track, theme: TrackTheme, rng: () => number): void {
  const c = centroid(track);
  const waterY = track.minY - 0.2;

  // Shoulders piers stay under the deck, inset from the edge. Do not move them inward.
  const dummy = new THREE.Object3D();
  const pierGeo = new THREE.BoxGeometry(1.1, 1, 1.1);
  const pierMat = std(0x8d99a3, 0.46, 0.42);
  const piers = new THREE.InstancedMesh(pierGeo, pierMat, 48);
  let pi = 0;
  for (let i = 0; i < track.samples.length && pi < 48; i += 8) {
    const s = track.samples[i]!;
    const drop = s.y - track.minY;
    if (drop < 3.2) continue;
    const h = Math.max(2.2, drop - 0.45);
    for (const side of [-1, 1]) {
      if (pi >= 48) break;
      const lat = (s.width * 0.5 - 1.6) * side;
      dummy.position.set(s.x + s.rx * lat, track.minY + h * 0.5, s.z + s.rz * lat);
      dummy.scale.set(1, h, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      piers.setMatrixAt(pi, dummy.matrix);
      const capY = track.minY + h - 0.15;
      boxes.add(1, s.x + s.rx * lat, capY, s.z + s.rz * lat, new THREE.Quaternion(), 1.55, 0.28, 1.55);
      pi++;
    }
  }
  piers.count = pi;
  piers.frustumCulled = false;
  parent.add(piers);

  // Offshore turbines. Far enough that blades cannot reach the racing line.
  const bladeGeo = new THREE.BoxGeometry(0.42, 16, 0.18);
  bladeGeo.translate(0, 9.4, 0);
  const steel = std(0xc5ced6, 0.38, 0.55);
  const bladeMat = std(0xd5dde4, 0.42, 0.25);
  let turbines = 0;
  each(track.samples, 180, 40, rng, (s) => {
    if (turbines >= 7 || Math.abs(s.curv) > 0.008) return;
    const sign = outerSign(s, c);
    const dist = s.width * 0.5 + (turbines % 2 === 0 ? 42 : 130) + rng() * 55;
    const x = s.x - s.rx * sign * dist;
    const z = s.z - s.rz * sign * dist;
    const g = new THREE.Group();
    g.position.set(x, waterY, z);
    const scale = 0.75 + rng() * 1.15;
    g.scale.setScalar(scale);
    g.rotation.y = Math.atan2(s.tx, s.tz) + rng() * 1.4;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.7, 36, 6), steel);
    mast.position.y = 18;
    const nacelle = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.25, 4.2), steel);
    nacelle.position.set(0, 36.2, 0.6);
    const hub = new THREE.Group();
    hub.position.set(0, 36.2, 2.4);
    hub.rotation.z = rng() * Math.PI * 2;
    for (let b = 0; b < 3; b++) {
      const blade = new THREE.Mesh(bladeGeo, bladeMat);
      blade.rotation.z = (b * Math.PI * 2) / 3;
      hub.add(blade);
    }
    g.add(mast, nacelle, hub);
    parent.add(g);
    turbines++;
  });

  const hillMat = std(0x3a5368, 0.92, 0.02);
  const spanReach = Math.max(track.maxX - track.minX, track.maxZ - track.minZ);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    const dist = spanReach * 0.42;
    let x = c.x + Math.cos(a) * dist;
    let z = c.z + Math.sin(a) * dist;
    for (let n = 0; n < 6; n++) {
      let nearest = Infinity;
      let near = track.samples[0]!;
      for (const s of track.samples) {
        const d = Math.hypot(s.x - x, s.z - z);
        if (d < nearest) {
          nearest = d;
          near = s;
        }
      }
      if (nearest > 90) break;
      const dx = x - near.x;
      const dz = z - near.z;
      const len = Math.hypot(dx, dz) || 1;
      x += (dx / len) * (96 - nearest);
      z += (dz / len) * (96 - nearest);
    }
    const h = 28 + rng() * 54;
    const hill = new THREE.Mesh(new THREE.ConeGeometry(34 + rng() * 28, h, 6), hillMat);
    hill.position.set(x, waterY + h * 0.42, z);
    parent.add(hill);
  }

  const bridgeStraight = straightOf(track, theme.straightAnchorZ);
  const portals = [40, 130, 230].map((along) => advance(bridgeStraight, along));
  for (const s of portals) {
    const bm = basisOf(s);
    const bq = new THREE.Quaternion().setFromRotationMatrix(bm);
    const side = s.width * 0.5 + 6.2;
    const h = 24;
    for (const sign of [1, -1]) {
      boxes.addLocal(0, s, bq, bm, sign * side, h * 0.16, 0, 3.6, h * 0.32, 3.2);
      boxes.addLocal(1, s, bq, bm, sign * side, h * 0.58, 0, 1.7, h * 0.72, 1.7);
      boxes.addLocal(1, s, bq, bm, sign * side, h + 0.7, 0, 2.6, 1.5, 2.4);
      boxes.addLocal(5, s, bq, bm, sign * side, h + 1.2, 0, 1.2, 0.28, 1.2);
    }
    boxes.addLocal(1, s, bq, bm, 0, h + 0.15, 0, side * 2 + 3, 1.15, 1.45);
    for (const sign of [1, -1]) {
      for (let k = 0; k < 3; k++) {
        const x = sign * (s.width * 0.5 + 1.8 + k * 1.6);
        boxes.addLocal(1, s, bq, bm, x, h * 0.5, 0.4, 0.07, h, 0.07);
      }
    }
  }
  // Approach gantry legs already exist; add a fascia rhythm under elevated sections via boxes.
  each(track.samples, 34, 0, rng, (s) => {
    if (s.y - track.minY < 3.5) return;
    const bm = basisOf(s);
    const bq = new THREE.Quaternion().setFromRotationMatrix(bm);
    boxes.addLocal(1, s, bq, bm, 0, -0.85, 0, s.width - 1.2, 0.22, 0.35);
  });

  // Sparse scrub on the outer bank, never on asphalt.
  let scrub = 0;
  each(track.samples, 28, 10, rng, (s) => {
    if (scrub > 36) return;
    const sm = basisOf(s);
    const sq = new THREE.Quaternion().setFromRotationMatrix(sm);
    const side = outerSign(s, c);
    const p = new THREE.Vector3(side * (s.width * 0.5 + 16 + rng() * 10), waterY - s.y + 1.2, 0).applyMatrix4(sm);
    cyl.add(1, s.x + p.x, s.y + p.y, s.z + p.z, sq, 2.4, 2.4 + rng() * 2, 2.4);
    scrub++;
  });
  void theme;
}

function populateCore(parent: THREE.Object3D, boxes: Batch, cyl: Batch, track: Track, rng: () => number): void {
  const c = centroid(track);
  let rx = c.x;
  let rz = c.z;
  for (let n = 0; n < 5; n++) {
    let nearest = Infinity;
    let near = track.samples[0]!;
    for (const s of track.samples) {
      const d = Math.hypot(s.x - rx, s.z - rz);
      if (d < nearest) {
        nearest = d;
        near = s;
      }
    }
    if (nearest > 46) break;
    const dx = rx - near.x;
    const dz = rz - near.z;
    const len = Math.hypot(dx, dz) || 1;
    rx += (dx / len) * (52 - nearest);
    rz += (dz / len) * (52 - nearest);
  }
  const base = track.minY;
  const q = new THREE.Quaternion();
  cyl.add(0, rx, base + 1.6, rz, q, 26, 3.2, 26);
  cyl.add(2, rx, base + 18, rz, q, 14, 32, 14);
  cyl.add(0, rx, base + 16, rz, q, 15.2, 1.4, 15.2);
  cyl.add(1, rx, base + 33, rz, q, 9.5, 1.1, 9.5);
  cyl.add(0, rx, base + 36, rz, q, 7.2, 8, 7.2);
  cyl.add(0, rx, base + 42, rz, q, 2.6, 4.2, 2.6);
  cyl.add(0, rx + 22, base + 9, rz + 10, q, 4.2, 18, 4.2);
  cyl.add(0, rx - 18, base + 7, rz - 12, q, 3.4, 14, 3.4);
  cyl.add(0, rx + 6, base + 8, rz - 22, q, 3.1, 16, 3.1);
  boxes.add(1, rx, base + 5.2, rz, q, 28, 0.45, 28);
  boxes.add(1, rx, base + 22, rz, q, 20, 0.35, 20);
  boxes.add(5, rx, base + 26, rz, q, 16, 0.16, 16);
  boxes.add(4, rx, base + 38, rz, q, 2.2, 0.35, 2.2, new THREE.Color(0x8ec8ff));
  boxes.add(4, rx, base + 12, rz, q, 1.4, 0.28, 1.4, new THREE.Color(0xff3355));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    boxes.add(1, rx + Math.cos(a) * 8, base + 8 + i * 6, rz + Math.sin(a) * 8, q, 0.35, 7, 0.35);
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.35;
    const len = i % 2 === 0 ? 16 : 11;
    const px = rx + Math.cos(a) * 11;
    const pz = rz + Math.sin(a) * 11;
    const pipeQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
    const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    pipeQ.multiply(tilt);
    cyl.add(2, px + Math.cos(a) * len * 0.5, base + 6.5 + (i % 3), pz + Math.sin(a) * len * 0.5, pipeQ, i % 2 === 0 ? 0.85 : 0.45, len, i % 2 === 0 ? 0.85 : 0.45);
    boxes.add(3, px, base + 0.6, pz, q, 1.6, 1.2, 1.6);
  }

  const torus = new THREE.Mesh(
    new THREE.TorusGeometry(11.5, 0.35, 8, 28),
    std(0x3a3034, 0.4, 0.62, 0xff3355, 0.28),
  );
  torus.rotation.x = Math.PI / 2;
  torus.position.set(rx, base + 18, rz);
  parent.add(torus);
  const park = (x: number, z: number, min: number) => {
    let px = x;
    let pz = z;
    for (let n = 0; n < 4; n++) {
      let nearest = Infinity;
      let near = track.samples[0]!;
      for (const s of track.samples) {
        const d = Math.hypot(s.x - px, s.z - pz);
        if (d < nearest) {
          nearest = d;
          near = s;
        }
      }
      if (nearest > min) break;
      const dx = px - near.x;
      const dz = pz - near.z;
      const len = Math.hypot(dx, dz) || 1;
      px += (dx / len) * (min - nearest + 3);
      pz += (dz / len) * (min - nearest + 3);
    }
    return { px, pz };
  };
  const coolA = park(rx + 24, rz + 10, 48);
  const stack = new THREE.Mesh(new THREE.CylinderGeometry(7.2, 12.4, 42, 14), std(0x4a4242, 0.62, 0.32));
  stack.position.set(coolA.px, base + 21, coolA.pz);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(9.4, 0.55, 6, 20), std(0x5a4848, 0.4, 0.55, 0xff3355, 0.22));
  lip.rotation.x = Math.PI / 2;
  lip.position.set(coolA.px, base + 41, coolA.pz);
  const coolB = park(rx - 30, rz + 18, 48);
  const stackB = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 6.4, 28, 12), std(0x3e3838, 0.58, 0.38));
  stackB.position.set(coolB.px, base + 14, coolB.pz);
  parent.add(stack, lip, stackB);

  const coreStraight = straightOf(track, 0);
  const cSign = outerSign(coreStraight, c);
  const hero = advance(coreStraight, 70);
  const hm = basisOf(hero);
  const hq = new THREE.Quaternion().setFromRotationMatrix(hm);
  const hx = cSign * (hero.width * 0.5 + 20);
  const hp = new THREE.Vector3(hx, 16, 0).applyMatrix4(hm);
  cyl.add(0, hero.x + hp.x, hero.y + 16, hero.z + hp.z, hq, 7.5, 32, 7.5);
  boxes.add(5, hero.x + hp.x, hero.y + 32.4, hero.z + hp.z, hq, 3.2, 0.4, 3.2);
  boxes.addLocal(1, hero, hq, hm, 0, 7.4, 0, hero.width + 6, 0.45, 0.7);
  boxes.addLocal(1, hero, hq, hm, hero.width * 0.5 + 1.4, 3.7, 0, 0.45, 7.4, 0.45);
  boxes.addLocal(1, hero, hq, hm, -(hero.width * 0.5 + 1.4), 3.7, 0, 0.45, 7.4, 0.45);
  boxes.addLocal(4, hero, hq, hm, 0, 7.1, 0.4, hero.width * 0.4, 0.08, 0.12, new THREE.Color(0xff4466));
  cyl.add(2, rx + 10, base + 8, rz, q, 0.9, 8, 0.9);
  cyl.add(2, rx, base + 8, rz + 10, q, 0.7, 8, 0.7);

  each(track.samples, 36, 14, rng, (s) => {
    const sign = outerSign(s, c);
    const gap = 11 + rng() * 6 + (Math.abs(s.curv) > 0.018 ? 4 : 0);
    const depth = 8 + rng() * 4;
    const h = 7 + rng() * 8;
    const m = basisOf(s);
    const bq = new THREE.Quaternion().setFromRotationMatrix(m);
    const parts: Part[] = [
      [0, h * 0.45, 0, depth, h * 0.9, 16, 10],
      [0, h * 0.95, 0, depth * 0.72, h * 0.4, 14, 1],
      [depth * 0.2, h * 1.15, 0, depth * 0.35, h * 0.22, 8, 1],
      [0, 1.2, 8.05, 1.3, 2.2, 0.12, 3],
      [0, h * 0.55, 8.08, depth * 0.45, 0.7, 0.08, 4],
    ];
    placeKit(boxes, s, bq, m, sign, gap, parts, depth, "core", rng, 0);
    // Pipe run tied into a riser so it reads as a line, not spaghetti.
    const pipeX = sign * (s.width * 0.5 + 4.2);
    const len = 14;
    const localTilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    const pq = bq.clone().multiply(localTilt);
    const p = new THREE.Vector3(pipeX, 2.3, 0).applyMatrix4(m);
    cyl.add(2, s.x + p.x, s.y + p.y, s.z + p.z, pq, 0.42, len, 0.42);
    if (rng() > 0.62) {
      cyl.add(2, s.x + p.x, s.y + 1.15, s.z + p.z, bq, 0.38, 2.3, 0.38);
      boxes.add(5, s.x + p.x, s.y + 0.4, s.z + p.z, bq, 1.4, 0.8, 1.4);
    }
  });

  // Overhead industrial spans. Clearance stays well above the cars.
  let spans = 0;
  each(track.samples, 70, 10, rng, (s) => {
    if (spans >= 8) return;
    const m = basisOf(s);
    const bq = new THREE.Quaternion().setFromRotationMatrix(m);
    const span = s.width + 5.5;
    boxes.addLocal(1, s, bq, m, span * 0.5 - 0.8, 3.6, 0, 0.4, 7.2, 0.4);
    boxes.addLocal(1, s, bq, m, -(span * 0.5 - 0.8), 3.6, 0, 0.4, 7.2, 0.4);
    boxes.addLocal(1, s, bq, m, 0, 7.15, 0, span, 0.32, 0.55);
    boxes.addLocal(spans % 2 === 0 ? 4 : 5, s, bq, m, 0, 6.85, 0.35, span * 0.55, 0.06, 0.12);
    spans++;
  });

  // Enclosing perimeter so the infield isn't a void.
  each(track.samples, 55, 16, rng, (s) => {
    const sign = outerSign(s, c);
    const m = basisOf(s);
    const bq = new THREE.Quaternion().setFromRotationMatrix(m);
    const h = 16 + rng() * 14;
    placeKit(boxes, s, bq, m, sign, 28 + rng() * 10, [
      [0, h * 0.5, 0, 8, h, 12, 6],
      [0, h * 0.4, 0, 0.2, 0.3, 8, 4],
    ], 8, "core", rng, 0);
  });
}

function addTunnelShell(boxes: Batch, parent: THREE.Object3D, track: Track, theme: TrackTheme): void {
  const limit = theme.tunnelBelow;
  if (limit == null) return;
  const core = theme.kind === "core";
  const picks: Sample[] = [];
  let acc = 10;
  for (const s of track.samples) {
    if (s.y > limit) {
      acc = 10;
      continue;
    }
    acc += s.segLen;
    if (acc < 4.4) continue;
    acc = 0;
    picks.push(s);
  }
  if (picks.length < 3) return;
  picks.forEach((s, i) => {
    const m = basisOf(s);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    const span = s.width + (core ? 3.2 : 2.4);
    const depth = 5.1;
    const mouth = i < 3 || i > picks.length - 4;
    boxes.addLocal(core ? 1 : 0, s, q, m, 0, core ? 4.15 : 3.85, 0, span, core ? 0.7 : 0.48, depth);
    boxes.addLocal(0, s, q, m, s.width * 0.5 + 1.35, 2.05, 0, core ? 0.95 : 0.7, 4.1, depth);
    boxes.addLocal(0, s, q, m, -(s.width * 0.5 + 1.35), 2.05, 0, core ? 0.95 : 0.7, 4.1, depth);
    boxes.addLocal(1, s, q, m, s.width * 0.32, 3.45, 0, 0.22, 0.22, depth);
    boxes.addLocal(1, s, q, m, -s.width * 0.32, 3.45, 0, 0.22, 0.22, depth);
    if (i % 2 === 0) {
      boxes.addLocal(1, s, q, m, 0, 4.35, 0, span + 0.6, 0.18, 0.28);
      const strip = core ? (i % 4 === 0 ? 4 : 5) : 4;
      const tint = core ? (i % 4 === 0 ? new THREE.Color(0xff4466) : new THREE.Color(0x8ec8ff)) : new THREE.Color(0xffc56a);
      boxes.addLocal(strip, s, q, m, s.width * 0.5 + 0.7, 3.25, 0, 0.12, 0.08, 2.2, tint);
      boxes.addLocal(strip, s, q, m, -(s.width * 0.5 + 0.7), 3.25, 0, 0.12, 0.08, 2.2, tint);
    }
    if (mouth) {
      const tint = core ? new THREE.Color(0xffd0d8) : new THREE.Color(0xffe2b0);
      boxes.addLocal(4, s, q, m, 0, 3.35, 0, span * 0.45, 0.08, 0.55, tint);
    }
  });
  const portal = (s: Sample, face: number) => {
    const m = basisOf(s);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    const span = s.width + (core ? 5.2 : 3.6);
    boxes.addLocal(1, s, q, m, 0, 4.35, face, span, 1.15, 1.15);
    boxes.addLocal(1, s, q, m, span * 0.5, 2.2, face, 1.15, 4.6, 1.15);
    boxes.addLocal(1, s, q, m, -span * 0.5, 2.2, face, 1.15, 4.6, 1.15);
    boxes.addLocal(0, s, q, m, 0, 4.9, face * 1.4, span + 1.2, 0.45, 0.55);
  };
  portal(picks[0]!, 2.4);
  portal(picks[picks.length - 1]!, -2.4);
  for (const s of [picks[0]!, picks[picks.length - 1]!]) {
    const lamp = new THREE.PointLight(core ? 0xff8894 : 0xffc56a, 1.6, 24, 2);
    lamp.position.set(s.x, s.y + 3.4, s.z);
    parent.add(lamp);
  }
}

export function addScenery(parent: THREE.Object3D, track: Track, theme: TrackTheme): void {
  const kind = theme.kind;
  const rng = mulberry32(theme.citySeed);
  const city = kind === "city";
  const yard = kind === "yard";
  const coast = kind === "coast";
  const core = kind === "core";

  const concrete = std(city ? 0x5a6878 : yard ? 0x4e453c : coast ? 0x3d4e58 : 0x46383c, 0.86, 0.08);
  const steel = std(city ? 0x6d7884 : yard ? 0x5c5348 : coast ? 0xc5ced6 : 0x4a4044, city ? 0.38 : 0.4, 0.62);
  const glass = facadeMat(facadeTex(city ? "band" : "works"), city ? 0.72 : 0.4);
  const trim = std(0x1c2228, 0.72, 0.2);
  const windows = lit(0xffffff);
  const accent = std(0x1a1e24, 0.45, 0.35, city ? 0x2ee6ff : yard ? 0xffb020 : coast ? 0xb7f4ff : 0xff3355, city ? 0.22 : 0.28);
  const farMat = std(city ? 0x2c3e52 : yard ? 0x32281e : coast ? 0x2a4254 : 0x321e24, 0.9, 0.04, city ? 0x102838 : 0x140e10, 0.2);
  const band = facadeMat(facadeTex("band"), city ? 1.25 : 0.45);
  const vert = facadeMat(facadeTex("vert"), city ? 1.2 : 0.45);
  const cluster = facadeMat(facadeTex("cluster"), city ? 1.05 : 0.4);
  const works = facadeMat(facadeTex("works"), yard || core ? 1.15 : 0.35);
  const boxes = new Batch(
    [concrete, steel, glass, trim, windows, accent, farMat, band, vert, cluster, works],
    [false, false, false, false, true, false, false, false, false, false, false],
  );
  const tank = std(yard ? 0x3a342c : 0x343034, 0.46, 0.62);
  const scrub = std(0x1a3330, 0.9, 0.02);
  const pipe = std(core ? 0x4a4044 : 0x3e3a36, 0.38, 0.7);
  const cyl = new Batch([tank, scrub, pipe], [false, false, false]);

  furniture(boxes, track, kind, rng);
  if (city) populateCity(boxes, track, theme, rng);
  if (yard) populateYard(boxes, cyl, track, rng);
  if (coast) populateCoast(parent, boxes, cyl, track, theme, rng);
  if (core) populateCore(parent, boxes, cyl, track, rng);
  addTunnelShell(boxes, parent, track, theme);

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
  boxes.flush(parent, boxGeo);
  cyl.flush(parent, cylGeo);
}
