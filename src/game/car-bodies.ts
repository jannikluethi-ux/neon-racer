import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { CarDims, CarId, CarRole } from "./car-model";
import type { WheelLayout } from "./car-model";

/**
 * Four separate body constructions. None of these is the shared loft.
 * Wheel positions are passed in from the physics layout and are not invented here.
 * +Z nose, -Z tail, +X driver's left, +Y up, origin on the tire contact plane.
 */

type Buckets = Record<CarRole, THREE.BufferGeometry[]>;

const ROLES: CarRole[] = ["paint", "carbon", "glass", "dark", "well", "accent", "lamp", "tail", "chrome"];

class Kit {
  private readonly buckets: Buckets = {
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

  add(role: CarRole, geometry: THREE.BufferGeometry): void {
    this.buckets[role].push(geometry);
  }

  /** Axis-aligned or rotated box. y is the centre. */
  box(role: CarRole, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): void {
    const raw = new THREE.BoxGeometry(w, h, d);
    const geometry = raw.toNonIndexed();
    raw.dispose();
    geometry.deleteAttribute("uv");
    if (rx) geometry.rotateX(rx);
    if (ry) geometry.rotateY(ry);
    if (rz) geometry.rotateZ(rz);
    geometry.translate(x, y, z);
    this.add(role, geometry);
  }

  /**
   * A solid that changes width and height from its rear face to its nose face.
   * yBase is the underside. z is the centre.
   */
  taper(
    role: CarRole,
    wRear: number,
    hRear: number,
    wNose: number,
    hNose: number,
    length: number,
    x: number,
    yBase: number,
    z: number,
  ): void {
    const z0 = -length / 2;
    const z1 = length / 2;
    const verts = new Float32Array([
      x - wRear / 2, yBase, z + z0,
      x + wRear / 2, yBase, z + z0,
      x + wRear / 2, yBase + hRear, z + z0,
      x - wRear / 2, yBase + hRear, z + z0,
      x - wNose / 2, yBase, z + z1,
      x + wNose / 2, yBase, z + z1,
      x + wNose / 2, yBase + hNose, z + z1,
      x - wNose / 2, yBase + hNose, z + z1,
    ]);
    const index = [
      0, 2, 1, 0, 3, 2,
      4, 5, 6, 4, 6, 7,
      0, 1, 5, 0, 5, 4,
      3, 7, 6, 3, 6, 2,
      0, 4, 7, 0, 7, 3,
      1, 2, 6, 1, 6, 5,
    ];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    this.add(role, geometry.toNonIndexed());
    geometry.dispose();
  }

  /** Open half-cylinder over a wheel, axis along X, opening downward. */
  arch(role: CarRole, radius: number, width: number, x: number, y: number, z: number): void {
    const raw = new THREE.CylinderGeometry(radius, radius, width, 16, 1, true, 0, Math.PI);
    raw.rotateZ(Math.PI / 2);
    raw.translate(x, y, z);
    const geometry = raw.toNonIndexed();
    raw.dispose();
    geometry.deleteAttribute("uv");
    this.add(role, geometry);
  }

  sphere(role: CarRole, sx: number, sy: number, sz: number, x: number, y: number, z: number): void {
    const raw = new THREE.SphereGeometry(1, 18, 12);
    raw.scale(sx, sy, sz);
    raw.translate(x, y, z);
    const geometry = raw.toNonIndexed();
    raw.dispose();
    geometry.deleteAttribute("uv");
    this.add(role, geometry);
  }

  finish(): Partial<Record<CarRole, THREE.BufferGeometry>> {
    const out: Partial<Record<CarRole, THREE.BufferGeometry>> = {};
    for (const role of ROLES) {
      const list = this.buckets[role];
      if (!list.length) continue;
      const merged = mergeGeometries(list, false);
      for (const geometry of list) geometry.dispose();
      if (!merged) throw new Error(`body merge failed for ${role}`);
      out[role] = merged;
    }
    return out;
  }
}

function lamps(kit: Kit, x: number, y: number, z: number, w: number, h: number): void {
  for (const side of [-1, 1]) {
    kit.box("dark", w, h + 0.02, 0.08, side * x, y, z);
    kit.box("lamp", w * 0.82, h, 0.04, side * x, y, z + 0.03);
  }
}

function tailLamps(kit: Kit, x: number, y: number, z: number, w: number, h: number): void {
  for (const side of [-1, 1]) {
    kit.box("dark", w, h + 0.03, 0.06, side * x, y, z);
    kit.box("tail", w * 0.84, h, 0.04, side * x, y, z - 0.02);
  }
}

function sills(kit: Kit, half: number, z0: number, z1: number, y: number): void {
  const len = z1 - z0;
  kit.box("accent", 0.04, 0.03, len, half, y, (z0 + z1) / 2);
  kit.box("accent", 0.04, 0.03, len, -half, y, (z0 + z1) / 2);
  kit.box("carbon", 0.08, 0.06, len, half - 0.02, y - 0.02, (z0 + z1) / 2);
  kit.box("carbon", 0.08, 0.06, len, -(half - 0.02), y - 0.02, (z0 + z1) / 2);
}

/** Long-hood front-engine GT coupe. Fastback, haunches, a proper GT wing. */
function buildVector(layout: WheelLayout): Kit {
  const kit = new Kit();
  const floor = 0.16;
  kit.box("carbon", 1.7, 0.08, 3.7, 0, floor, 0.05);
  kit.taper("paint", 1.72, 0.48, 1.35, 0.32, 1.7, 0, floor, 1.15);
  kit.taper("paint", 1.55, 0.72, 1.72, 0.5, 0.7, 0, floor, 0.35);
  kit.box("paint", 1.45, 0.42, 1.15, 0, 0.78, -0.15);
  kit.taper("glass", 1.15, 0.42, 1.35, 0.08, 0.55, 0, 0.72, 0.55);
  kit.box("glass", 1.05, 0.08, 0.7, 0, 1.18, -0.15);
  kit.taper("paint", 1.2, 0.55, 1.55, 0.22, 0.85, 0, 0.62, -0.85);
  kit.taper("paint", 1.55, 0.38, 1.35, 0.28, 0.7, 0, floor, -1.55);
  kit.box("carbon", 1.5, 0.06, 0.42, 0, 0.12, 2.05);
  kit.box("dark", 0.7, 0.12, 0.08, 0, 0.28, 1.95);
  lamps(kit, 0.52, 0.42, 1.98, 0.36, 0.045);
  for (const side of [-1, 1] as const) {
    kit.arch("paint", layout.frontRadius + 0.08, 0.34, side * layout.frontX, layout.frontRadius + 0.05, layout.frontZ);
    kit.arch("paint", layout.rearRadius + 0.1, 0.4, side * layout.rearX, layout.rearRadius + 0.06, layout.rearZ);
    kit.box("paint", 0.28, 0.22, 0.7, side * 0.78, 0.55, layout.rearZ + 0.05);
    kit.box("dark", 0.12, 0.06, 0.16, side * 1.02, 0.78, 0.35);
  }
  sills(kit, 0.92, layout.rearZ + 0.35, layout.frontZ - 0.3, 0.2);
  kit.box("carbon", 1.7, 0.05, 0.42, 0, 1.12, -1.72);
  kit.box("carbon", 0.04, 0.28, 0.36, 0.84, 0.98, -1.7);
  kit.box("carbon", 0.04, 0.28, 0.36, -0.84, 0.98, -1.7);
  kit.box("carbon", 0.04, 0.22, 0.08, 0.42, 0.85, -1.7);
  kit.box("carbon", 0.04, 0.22, 0.08, -0.42, 0.85, -1.7);
  kit.taper("carbon", 1.4, 0.16, 1.2, 0.04, 0.5, 0, 0.1, -1.85);
  tailLamps(kit, 0.58, 0.48, -1.95, 0.32, 0.07);
  kit.box("chrome", 0.08, 0.08, 0.12, 0.28, 0.28, -2.0);
  kit.box("chrome", 0.08, 0.08, 0.12, -0.28, 0.28, -2.0);
  return kit;
}

/** Compact, taller, shorter mid-engine coupe. Upright glass and a small ducktail. */
function buildVanta(layout: WheelLayout): Kit {
  const kit = new Kit();
  const floor = 0.18;
  kit.box("carbon", 1.65, 0.08, 3.15, 0, floor, -0.05);
  kit.taper("paint", 1.7, 0.7, 1.45, 0.55, 0.85, 0, floor, 1.15);
  kit.box("paint", 1.58, 0.78, 1.35, 0, 0.78, 0.05);
  kit.taper("glass", 1.2, 0.28, 1.35, 0.06, 0.32, 0, 0.95, 0.62);
  kit.box("glass", 1.15, 0.16, 0.7, 0, 1.22, 0.05);
  kit.taper("paint", 1.35, 0.62, 1.6, 0.4, 0.9, 0, floor + 0.15, -0.85);
  kit.box("paint", 1.5, 0.4, 0.45, 0, 0.48, -1.45);
  kit.box("dark", 0.55, 0.16, 0.08, 0, 0.38, 1.52);
  lamps(kit, 0.48, 0.58, 1.55, 0.22, 0.1);
  for (const side of [-1, 1] as const) {
    kit.arch("paint", layout.frontRadius + 0.07, 0.32, side * layout.frontX, layout.frontRadius + 0.04, layout.frontZ);
    kit.arch("paint", layout.rearRadius + 0.11, 0.42, side * layout.rearX, layout.rearRadius + 0.05, layout.rearZ);
    kit.box("carbon", 0.22, 0.16, 0.45, side * 0.82, 0.48, -0.55);
    kit.box("dark", 0.08, 0.1, 0.22, side * 0.9, 0.52, -0.55);
  }
  sills(kit, 0.9, -0.85, 0.7, 0.22);
  kit.box("carbon", 1.45, 0.06, 0.28, 0, 0.95, -1.35);
  kit.box("carbon", 0.03, 0.16, 0.22, 0.72, 0.98, -1.32);
  kit.box("carbon", 0.03, 0.16, 0.22, -0.72, 0.98, -1.32);
  tailLamps(kit, 0.55, 0.62, -1.58, 0.24, 0.12);
  kit.box("chrome", 0.1, 0.1, 0.1, 0, 0.32, -1.62);
  return kit;
}

/**
 * Closed-cockpit LMP. Wide flat tub, raised front fenders, low nose between
 * them, bubble canopy, deep sidepods, engine cover, shark fin, endplate wing.
 */
function buildSurge(layout: WheelLayout): Kit {
  const kit = new Kit();
  const tubY = 0.22;
  kit.box("carbon", 1.95, 0.1, 4.5, 0, tubY - 0.02, 0.05);
  kit.taper("paint", 0.72, 0.22, 0.28, 0.1, 1.35, 0, 0.16, 1.55);
  kit.box("paint", 0.9, 0.16, 0.8, 0, 0.28, 0.85);
  for (const side of [-1, 1] as const) {
    kit.box("paint", 0.42, 0.28, 1.15, side * layout.frontX, 0.42, layout.frontZ + 0.05);
    kit.arch("paint", layout.frontRadius + 0.06, 0.38, side * layout.frontX, layout.frontRadius + 0.08, layout.frontZ);
    kit.box("paint", 0.5, 0.34, 2.7, side * 0.72, 0.38, -0.05);
    kit.box("dark", 0.18, 0.14, 0.7, side * 0.9, 0.32, -0.2);
    kit.arch("paint", layout.rearRadius + 0.08, 0.4, side * layout.rearX, layout.rearRadius + 0.06, layout.rearZ);
    kit.box("carbon", 0.05, 0.42, 0.55, side * 0.95, 0.78, -2.05);
  }
  kit.sphere("glass", 0.34, 0.22, 0.62, 0, 0.58, -0.02);
  kit.box("dark", 0.5, 0.06, 0.15, 0, 0.5, 0.48);
  kit.box("paint", 0.7, 0.28, 1.15, 0, 0.42, -1.15);
  kit.taper("paint", 0.85, 0.34, 0.55, 0.18, 0.7, 0, 0.28, -1.85);
  kit.box("carbon", 0.035, 0.42, 1.15, 0, 0.78, -0.85);
  kit.box("carbon", 1.85, 0.045, 0.48, 0, 0.95, -2.15);
  kit.box("carbon", 0.04, 0.16, 0.08, 0.55, 0.72, -2.1);
  kit.box("carbon", 0.04, 0.16, 0.08, -0.55, 0.72, -2.1);
  kit.taper("carbon", 1.5, 0.18, 1.15, 0.04, 0.55, 0, 0.1, -2.15);
  lamps(kit, 0.22, 0.3, 2.05, 0.16, 0.03);
  tailLamps(kit, 0.48, 0.36, -2.18, 0.2, 0.045);
  kit.box("accent", 0.03, 0.04, 1.6, 0.98, 0.34, 0.1);
  kit.box("accent", 0.03, 0.04, 1.6, -0.98, 0.34, 0.1);
  return kit;
}

/** Boxy hatchback touring car. Upright greenhouse, flared arches, roof wing. */
function buildAegis(layout: WheelLayout): Kit {
  const kit = new Kit();
  const floor = 0.18;
  kit.box("carbon", 1.9, 0.08, 3.6, 0, floor, 0);
  kit.box("paint", 1.85, 0.62, 2.15, 0, floor + 0.31, 0.15);
  kit.box("paint", 1.7, 0.48, 0.7, 0, floor + 0.24, 1.4);
  kit.box("paint", 1.75, 0.5, 0.55, 0, floor + 0.28, -1.45);
  kit.box("paint", 1.55, 0.38, 1.35, 0, 1.02, -0.05);
  kit.box("glass", 1.4, 0.32, 1.05, 0, 1.08, 0.05);
  kit.box("glass", 1.25, 0.22, 0.12, 0, 0.95, 0.62);
  kit.box("glass", 1.2, 0.2, 0.08, 0, 0.92, -0.62);
  kit.box("dark", 1.15, 0.08, 0.06, 0, 0.42, 1.78);
  lamps(kit, 0.62, 0.55, 1.78, 0.42, 0.07);
  for (const side of [-1, 1] as const) {
    kit.arch("paint", layout.frontRadius + 0.06, 0.36, side * layout.frontX, layout.frontRadius + 0.02, layout.frontZ);
    kit.arch("paint", layout.rearRadius + 0.07, 0.4, side * layout.rearX, layout.rearRadius + 0.02, layout.rearZ);
    kit.box("paint", 0.16, 0.2, 0.85, side * (layout.frontX + 0.12), 0.48, layout.frontZ);
    kit.box("paint", 0.16, 0.22, 0.9, side * (layout.rearX + 0.1), 0.5, layout.rearZ);
    kit.box("dark", 0.1, 0.08, 0.55, side * 0.95, 0.72, 0.05);
  }
  sills(kit, 1.0, -0.7, 0.75, 0.24);
  kit.box("carbon", 1.6, 0.05, 0.32, 0, 1.28, -0.95);
  kit.box("carbon", 0.04, 0.18, 0.28, 0.78, 1.2, -0.95);
  kit.box("carbon", 0.04, 0.18, 0.28, -0.78, 1.2, -0.95);
  tailLamps(kit, 0.62, 0.58, -1.68, 0.4, 0.1);
  kit.box("tail", 0.9, 0.035, 0.04, 0, 0.7, -1.7);
  kit.box("chrome", 0.09, 0.09, 0.1, 0.42, 0.3, -1.72);
  kit.box("chrome", 0.09, 0.09, 0.1, -0.42, 0.3, -1.72);
  return kit;
}

const BUILDERS: Record<CarId, (layout: WheelLayout) => Kit> = {
  vector: buildVector,
  vanta: buildVanta,
  surge: buildSurge,
  aegis: buildAegis,
};

export function buildBody(id: CarId, layout: WheelLayout): { parts: Partial<Record<CarRole, THREE.BufferGeometry>>; dims: CarDims } {
  const kit = BUILDERS[id](layout);
  const length =
    id === "surge" ? 4.7 : id === "vanta" ? 3.4 : id === "aegis" ? 3.9 : 4.2;
  const tipZ = id === "surge" ? 2.25 : id === "vanta" ? 1.65 : id === "aegis" ? 1.9 : 2.15;
  const tailZ = tipZ - length;
  const roofY = id === "surge" ? 0.82 : id === "vanta" ? 1.36 : id === "aegis" ? 1.28 : 1.22;
  const deckY = id === "surge" ? 0.55 : id === "vanta" ? 0.95 : id === "aegis" ? 0.7 : 0.78;
  return {
    parts: kit.finish(),
    dims: {
      halfWidth: layout.halfWidth,
      length,
      roofY,
      deckY,
      beltY: id === "aegis" ? 0.85 : id === "surge" ? 0.4 : 0.7,
      floorY: 0.16,
      tipZ,
      tailZ,
      frontW: layout.halfWidth * 0.92,
      rearW: layout.halfWidth * 0.96,
      frontAxleZ: layout.frontZ,
      rearAxleZ: layout.rearZ,
      lampY: id === "surge" ? 0.32 : id === "vanta" ? 0.58 : 0.48,
      lampZ: tipZ - 0.12,
      lampW: id === "surge" ? 0.16 : id === "aegis" ? 0.42 : 0.3,
      lampX: id === "surge" ? 0.22 : layout.halfWidth * 0.48,
      tailY: id === "surge" ? 0.36 : 0.55,
      tailZLamp: tailZ + 0.05,
      tailW: id === "aegis" ? 0.4 : 0.28,
      mirrorY: id === "surge" ? 0.55 : 0.78,
      mirrorZ: id === "vanta" ? 0.35 : 0.45,
      mirrorX: layout.halfWidth * 0.72,
      plateY: id === "surge" ? 0.42 : 0.55,
      numberScale: id === "aegis" ? 1.05 : 1,
      exhaustXs: id === "vanta" ? [0] : id === "surge" ? [-0.35, 0.35] : [-0.32, 0.32],
      exhaustY: 0.32,
      glowScale: layout.halfWidth,
      contactW: layout.halfWidth * 1.6,
      contactL: length * 0.42,
      wing: {
        span: layout.halfWidth * 1.6,
        chord: 0.36,
        y: roofY,
        z: tailZ + 0.2,
        deckY,
        thick: 0.05,
        dual: false,
        swan: false,
        gurney: false,
      },
      fin: id === "surge",
      canards: false,
      splitter: 0.35,
      skirt: 1,
      diffuserFins: 0,
      diffuserRise: 0.2,
    },
  };
}
