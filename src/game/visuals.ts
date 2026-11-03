import * as THREE from "three";
import type { CarState } from "./types";
import type { Gate, Sample, Track } from "./track";
import { sampleAt } from "./track";
import { themeFor, type TrackTheme } from "./track-def";
import { buildRoadSurfaces, type RoadSurfaces } from "./road-surface";
import { bodyWidthAt, buildCarGeometry, type CarDims, type CarRole } from "./car-model";
import { DECAL_CLEARANCE } from "./contact";
import { vehicleById } from "./vehicle-def";

/** One wheel: steer pivot, spinning hub and the contact patch decal under it. */
export type WheelRig = {
  pivot: THREE.Object3D;
  spin: THREE.Object3D;
  blob: THREE.Mesh;
  x: number;
  y: number;
  z: number;
  radius: number;
  front: boolean;
};

export type CarView = {
	root: THREE.Group;
	chassis: THREE.Group;
	wheels: THREE.Object3D[];
	frontPivots: THREE.Object3D[];
	rigs: WheelRig[];
	dims: CarDims;
	brakeMat: THREE.MeshStandardMaterial;
	paint: THREE.MeshPhysicalMaterial;
	boost: THREE.Object3D;
	glow: THREE.Mesh;
	contact: THREE.Mesh;
	headLight: THREE.SpotLight;
	tailLight: THREE.PointLight;
	boostLight: THREE.PointLight;
	hero: boolean;
	/** Front/rear visual suspension travel (m, negative = droop). */
	susp: [number, number];
	suspVel: [number, number];
	/** Body heave after a landing (m, negative = compressed). */
	heave: number;
	heaveVel: number;
	wasAir: boolean;
	stamp: number;
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
  road: RoadSurfaces;
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
  /** Vehicle definition id — the shape, not just the livery, comes from it. */
  id: string;
  rival: boolean;
};

// ---------------------------------------------------------------------------
// Vehicle construction
// ---------------------------------------------------------------------------

function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

const decalWheelCenter = new THREE.Vector3();
const decalRoadNormal = new THREE.Vector3();
const decalCircleNormal = new THREE.Vector3(0, 0, 1);
const decalRootQuaternion = new THREE.Quaternion();
const decalWorldQuaternion = new THREE.Quaternion();
const decalLocalQuaternion = new THREE.Quaternion();

/** Place one contact mark below that wheel's current world-space contact point. */
export function syncWheelContactDecal(
  root: THREE.Object3D,
  wheel: THREE.Object3D,
  decal: THREE.Object3D,
  radius: number,
  roadNormal?: readonly [number, number, number],
): void {
  wheel.getWorldPosition(decalWheelCenter);
  root.getWorldQuaternion(decalRootQuaternion);
  if (roadNormal) decalRoadNormal.fromArray(roadNormal);
  else decalRoadNormal.set(0, 1, 0).applyQuaternion(decalRootQuaternion);
  if (decalRoadNormal.lengthSq() < 1e-8) decalRoadNormal.set(0, 1, 0).applyQuaternion(decalRootQuaternion);
  decalRoadNormal.normalize();

  // The center was read from the actual wheel pivot, including suspension and
  // its own road-height residual. Offset along the local road normal so the
  // decal stays just above the asphalt on both gradients and kerb cross-slopes.
  decalWheelCenter.addScaledVector(decalRoadNormal, -radius + DECAL_CLEARANCE);
  decal.position.copy(root.worldToLocal(decalWheelCenter));
  decalWorldQuaternion.setFromUnitVectors(decalCircleNormal, decalRoadNormal);
  decalLocalQuaternion.copy(decalRootQuaternion).invert().multiply(decalWorldQuaternion);
  decal.quaternion.copy(decalLocalQuaternion);
}

/** Shared primitives reused by every car's trim, decals and effects. */
const geos = {  glow: new THREE.BoxGeometry(1.35, 0.04, 2.6),
  boost: (() => {
    const g = new THREE.ConeGeometry(0.14, 1.15, 7);
    g.rotateX(-Math.PI / 2);
    return g;
  })(),
  lens: new THREE.BoxGeometry(1, 1, 1),
  contact: new THREE.CircleGeometry(1.35, 20),
};

/** Look and livery live here; all hard geometry comes from car-model. */

function finishPaint(hex: number): THREE.Color {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(0.7, Math.max(0.4, hsl.s + 0.12)), Math.min(0.42, Math.max(0.2, hsl.l + 0.08)));
  return c;
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
    g.fillStyle = "rgba(5, 8, 13, 0.9)";
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

/** Sidewall banding, shoulder lettering stripe and tread blocks for the tire. */
function tireTexture(): THREE.CanvasTexture {
  const tex = canvasTex((g, w, h) => {
    g.fillStyle = "#191b1f";
    g.fillRect(0, 0, w, h);
    // v runs across the lathe profile: sidewall | tread | sidewall.
    const treadA = h * 0.31;
    const treadB = h * 0.69;
    g.fillStyle = "#101115";
    g.fillRect(0, treadA, w, treadB - treadA);
    // Tread blocks: deep lateral cuts across the contact band.
    for (let x = 0; x < w; x += 14) {
      g.fillStyle = "#05060a";
      g.fillRect(x, treadA, 5, treadB - treadA);
      g.fillStyle = "rgba(74,78,86,0.55)";
      g.fillRect(x + 6, treadA, 3, treadB - treadA);
      g.fillStyle = "rgba(58,62,70,0.4)";
      g.fillRect(x + 9, treadA, 2, treadB - treadA);
    }
    // Sidewall: raised ring plus a pale accent stripe like a race tire.
    for (const y of [h * 0.16, h * 0.84]) {
      g.fillStyle = "rgba(46,48,54,0.9)";
      g.fillRect(0, y - 3, w, 6);
      g.fillStyle = "rgba(70,74,82,0.8)";
      g.fillRect(0, y + 5, w, 2);
    }
    g.fillStyle = "rgba(120,126,136,0.55)";
    g.fillRect(0, h * 0.24, w, 2);
    g.fillRect(0, h * 0.76, w, 2);
    // Fine radial shoulder ribbing.
    for (let x = 0; x < w; x += 6) {
      g.fillStyle = "rgba(30,32,36,0.5)";
      g.fillRect(x, treadA - 6, 3, 6);
      g.fillRect(x, treadB, 3, 6);
    }
  }, 256, 128);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(4, 1);
  return tex;
}

/** Machined, cross-drilled face for the brake disc. */
function discTexture(): THREE.CanvasTexture {
  const tex = canvasTex((g, w, h) => {
    g.fillStyle = "#6e747b";
    g.fillRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    for (let r = 18; r < w * 0.5; r += 9) {
      g.strokeStyle = "rgba(150,158,166,0.35)";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = "#2a2d32";
    for (let ring = 0; ring < 3; ring++) {
      const r = 26 + ring * 16;
      const holes = 8 + ring * 5;
      for (let i = 0; i < holes; i++) {
        const a = (i / holes) * Math.PI * 2 + ring * 0.4;
        g.beginPath();
        g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 4, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.fillStyle = "#4b5057";
    g.beginPath();
    g.arc(cx, cy, 16, 0, Math.PI * 2);
    g.fill();
  }, 128, 128);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** 2x2 twill so the carbon parts read as woven rather than flat black. */
function carbonWeave(): THREE.CanvasTexture {
  const tex = canvasTex((g, w, h) => {
    g.fillStyle = "#0e1013";
    g.fillRect(0, 0, w, h);
    const cell = w / 6;
    for (let y = 0; y < h; y += cell) {
      for (let x = 0; x < w; x += cell) {
        const i = Math.round(x / cell) + Math.round(y / cell);
        g.fillStyle = i % 2 === 0 ? "#171a1f" : "#0a0c0f";
        g.fillRect(x, y, cell - 1, cell - 1);
      }
    }
    g.strokeStyle = "rgba(40,44,52,0.5)";
    g.lineWidth = 1;
    for (let i = 0; i <= 6; i++) {
      g.beginPath();
      g.moveTo(i * cell, 0);
      g.lineTo(i * cell, h);
      g.stroke();
      g.beginPath();
      g.moveTo(0, i * cell);
      g.lineTo(w, i * cell);
      g.stroke();
    }
  }, 96, 96);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function roleMaterial(role: CarRole, look: { body: THREE.Color; accent: number; hero: boolean }): THREE.Material {
  switch (role) {
    case "paint":
      // Metallic automotive paint: the body colour has to survive the env
      // reflection, so metalness stays moderate and the clearcoat carries the
      // shine instead of the base layer going mirror-silver.
      return new THREE.MeshPhysicalMaterial({
        color: look.body,
        roughness: 0.34,
        metalness: 0.38,
        clearcoat: 1,
        clearcoatRoughness: 0.08,
        envMapIntensity: 0.5,
        emissive: look.accent,
        emissiveIntensity: 0.025,
      });
    case "carbon": {
      const map = carbonWeave();
      map.repeat.set(1, 1);
      return new THREE.MeshStandardMaterial({
        color: 0x191c22,
        map,
        roughness: 0.36,
        metalness: 0.5,
        envMapIntensity: 0.7,
      });
    }
    case "glass":
      return new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(look.body).lerp(new THREE.Color(0x04060a), 0.86),
        roughness: 0.06,
        metalness: 0.15,
        transparent: true,
        opacity: 0.88,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        envMapIntensity: 1.0,
        depthWrite: true,
      });
    case "dark":
      return new THREE.MeshStandardMaterial({ color: 0x0b0d11, roughness: 0.5, metalness: 0.35, envMapIntensity: 0.5 });
    case "well":
      return new THREE.MeshStandardMaterial({ color: 0x06070a, roughness: 0.95, metalness: 0.0, envMapIntensity: 0.25 });
    case "accent":
      return new THREE.MeshStandardMaterial({
        color: 0x0d0f14,
        emissive: look.accent,
        emissiveIntensity: 0.6,
        roughness: 0.35,
        metalness: 0.3,
      });
    case "lamp":
      return new THREE.MeshStandardMaterial({
        color: 0xdfe9f5,
        emissive: 0xf2f8ff,
        emissiveIntensity: look.hero ? 1.5 : 1.0,
        roughness: 0.12,
        metalness: 0.2,
      });
    case "tail":
      return new THREE.MeshStandardMaterial({
        color: 0x3a0d16,
        emissive: 0xff2438,
        emissiveIntensity: 0.5,
        roughness: 0.3,
        metalness: 0.15,
      });
    case "chrome":
      return new THREE.MeshStandardMaterial({ color: 0x9aa4ae, roughness: 0.22, metalness: 0.95, envMapIntensity: 1.3 });
  }
}

export function createCarView(color: number, vehicleId: string, rival = false): CarView {
  const def = vehicleById(vehicleId);
  const role = rival ? roleFromColor(color) : "player";
  // Rivals keep their own livery colour tinted over the factory paint, so the
  // grid stays readable while each shape keeps its identity.
  const bodyHex = rival
    ? new THREE.Color(def.body.paint).lerp(new THREE.Color(color), 0.5).getHex()
    : def.body.paint;
  const look = {
    body: finishPaint(bodyHex),
    accent: rival ? color : def.body.accent,
    hero: !rival,
  };
  const built = buildCarGeometry(vehicleId);
  const dims = built.dims;
  const frontPivots: THREE.Object3D[] = [];

  const root = new THREE.Group();
  const chassis = new THREE.Group();
  chassis.name = "chassis";
  root.add(chassis);

  const materials = new Map<CarRole, THREE.Material>();
  const materialFor = (role: CarRole): THREE.Material => {
    let mat = materials.get(role);
    if (!mat) {
      mat = roleMaterial(role, look);
      materials.set(role, mat);
    }
    return mat;
  };
  const brakeMat = materialFor("tail") as THREE.MeshStandardMaterial;
  const paint = materialFor("paint") as THREE.MeshPhysicalMaterial;

  for (const role of Object.keys(built.parts) as CarRole[]) {
    const geo = built.parts[role];
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, materialFor(role));
    mesh.name = role;
    mesh.castShadow = role !== "well";
    chassis.add(mesh);
  }

  // Wheels: pivot (steer + suspension anchor) -> spin (rotation), with the
  // caliper on the pivot so it stays with the upright while the disc turns.
  const rigs: WheelRig[] = [];
  const wheelMat = new THREE.MeshStandardMaterial({
    color: 0x141519,
    map: tireTexture(),
    roughness: 0.94,
    metalness: 0.0,
    envMapIntensity: 0.35,
  });
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xc9d2da,
    roughness: 0.3,
    metalness: 0.9,
    envMapIntensity: 1.0,
  });
  const discMat = new THREE.MeshStandardMaterial({
    color: 0x8b9198,
    map: discTexture(),
    roughness: 0.38,
    metalness: 0.9,
    envMapIntensity: 1.0,
  });
  const caliperMat = new THREE.MeshStandardMaterial({
    color: look.accent,
    roughness: 0.34,
    metalness: 0.5,
    envMapIntensity: 0.9,
  });
  const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false });
  for (const spot of built.wheels) {
    const pivot = new THREE.Group();
    pivot.position.set(spot.x, spot.y, spot.z);
    const spin = new THREE.Group();
    const tire = new THREE.Mesh(spot.tire, wheelMat);
    const rim = new THREE.Mesh(spot.rim, rimMat);
    const disc = new THREE.Mesh(spot.disc, discMat);
    tire.castShadow = true;
    rim.castShadow = true;
    spin.add(tire, rim, disc);
    const caliper = new THREE.Mesh(spot.caliper, caliperMat);
    caliper.castShadow = true;
    pivot.add(spin, caliper);
    root.add(pivot);
    // Contact patch decal: stays flat on the road under this wheel.
    const blob = new THREE.Mesh(geos.contact, blobMat);
    blob.position.set(spot.x, DECAL_CLEARANCE, spot.z);
    blob.scale.set(0.24, 0.18, 1);
    root.add(blob);
    rigs.push({ pivot, spin, blob, x: spot.x, y: spot.y, z: spot.z, radius: spot.radius, front: spot.steered });
    if (spot.steered) frontPivots.push(pivot);
  }

  // Under-body shadow keeps the car planted between the wheel patches.
  const contact = new THREE.Mesh(
    geos.contact,
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }),
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.044;
  contact.scale.set(dims.halfWidth * 0.78, dims.length * 0.36, 1);
  root.add(contact);

  // Underglow reads as a floating slab from any low angle, so the accent light
  // now comes from the splitter blade and the emissive trim instead.
  const glowMat = new THREE.MeshBasicMaterial({ color: look.accent, transparent: true, opacity: 0 });
  const glow = new THREE.Mesh(geos.glow, glowMat);
  glow.position.set(0, 0.06, 0);
  glow.scale.set(0.01, 0.01, 0.01);
  glow.visible = false;

  // Race number plates: rear panel plus one per door.
  const numberMap = numberTexture(role, look.accent);
  const numberMat = new THREE.MeshBasicMaterial({ map: numberMap, transparent: true, toneMapped: false });
  const plateH = 0.34 * dims.numberScale;
  const rearNumber = new THREE.Mesh(new THREE.PlaneGeometry(plateH * 1.6, plateH), numberMat);
  rearNumber.position.set(0, dims.plateY, dims.tailZ - 0.03);
  rearNumber.rotation.y = Math.PI;
  chassis.add(rearNumber);
  for (const side of [-1, 1]) {
    const sideNumber = new THREE.Mesh(new THREE.PlaneGeometry(plateH * 1.5, plateH * 0.86), numberMat.clone());
    const x = bodyWidthAt(vehicleId, -0.3) * 0.955;
    sideNumber.position.set(side * x, dims.beltY - 0.14, -0.34);
    sideNumber.rotation.y = side * Math.PI * 0.5;
    chassis.add(sideNumber);
  }

  // Accent blade along the splitter's leading edge.
  const lip = new THREE.Mesh(geos.lens, materialFor("accent"));
  lip.scale.set(dims.halfWidth * 1.5, 0.016, 0.035);
  lip.position.set(0, dims.floorY - 0.004, dims.tipZ + dims.splitter * 0.06);
  chassis.add(lip);

  const headLight = new THREE.SpotLight(0xfff4e4, 3.4, 40, 0.5, 0.65, 1.4);
  headLight.position.set(0, dims.lampY, dims.lampZ);
  headLight.castShadow = false;
  const lightTarget = new THREE.Object3D();
  lightTarget.position.set(0, 0.15, 18);
  headLight.target = lightTarget;
  chassis.add(headLight, lightTarget);

  const tailLight = new THREE.PointLight(0xff1838, 0.08, 7, 2);
  tailLight.position.set(0, dims.tailY, dims.tailZ - 0.16);
  chassis.add(tailLight);

  const boost = new THREE.Group();
  const flameA = new THREE.MeshBasicMaterial({ color: look.accent, transparent: true, opacity: 0.85 });
  const flameB = new THREE.MeshBasicMaterial({ color: 0xfff6ea, transparent: true, opacity: 0.95 });
  const exhausts = dims.exhaustXs;
  const pair = exhausts.length > 2 ? [exhausts[1]!, exhausts[2]!] : [exhausts[0]!, exhausts[exhausts.length - 1]!];
  const flameZ = dims.tailZ - 0.12;
  const f1 = new THREE.Mesh(geos.boost, flameA);
  f1.position.set(pair[0]!, dims.exhaustY, flameZ);
  const f2 = new THREE.Mesh(geos.boost, flameB);
  f2.position.set(pair[1]!, dims.exhaustY, flameZ);
  const f3 = new THREE.Mesh(geos.boost, flameA);
  f3.position.set((pair[0]! + pair[1]!) * 0.5, dims.exhaustY - 0.01, flameZ - 0.14);
  f3.scale.set(0.65, 0.65, 1.15);
  boost.add(f1, f2, f3);
  boost.visible = false;
  chassis.add(boost);

  const boostLight = new THREE.PointLight(look.accent, 0, 6, 2);
  boostLight.position.set(0, dims.exhaustY, flameZ - 0.22);
  chassis.add(boostLight);

  return {
    root,
    chassis,
    wheels: rigs.map((rig) => rig.spin),
    frontPivots,
    rigs,
    dims,
    brakeMat,
    paint,
    boost,
    glow,
    contact,
    headLight,
    tailLight,
    boostLight,
    hero: look.hero,
    susp: [0, 0],
    suspVel: [0, 0],
    heave: 0,
    heaveVel: 0,
    wasAir: false,
    stamp: performance.now(),
  };
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
	// One tracked shadow cascade: the engine slides this light around the
	// player every frame, so a tight ortho box still gives crisp tire shadows
	// without paying for a whole-track shadow map on phones.
	moon.castShadow = true;
	moon.shadow.mapSize.set(1024, 1024);
	moon.shadow.camera.left = -34;
	moon.shadow.camera.right = 34;
	moon.shadow.camera.top = 34;
	moon.shadow.camera.bottom = -34;
	moon.shadow.camera.near = 1;
	moon.shadow.camera.far = 320;
	moon.shadow.bias = -0.0006;
	moon.shadow.normalBias = 0.035;
	scene.add(moon, moon.target);
	scene.userData.sun = moon;
	const fill = new THREE.DirectionalLight(theme.fillLight, theme.fillStrength);
	fill.position.set(-80, 40, -30);
	scene.add(fill);
	// Asphalt, kerbs, racing line, grid markings, barriers and rails all come
	// from one module so track geometry and road materials stay separable.
	const roadSurfaces = buildRoadSurfaces(track, theme);
	scene.add(roadSurfaces.group);
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
	ground.userData.noShadow = true;
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
		sea.userData.noShadow = true;
		scene.add(sea);
		const glint = new THREE.Mesh(new THREE.PlaneGeometry(160, 1600), new THREE.MeshBasicMaterial({
			color: 0xd7ecff,
			transparent: true,
			opacity: 0.2,
			depthWrite: false
		}));
		glint.rotation.x = -Math.PI / 2;
		glint.position.set(-40, track.minY - .05, -80);
		glint.userData.noShadow = true;
		scene.add(glint);
	}
	addStartGantry(dressing, track, theme);
	// Scenery is pure visual dressing (never consulted by physics/AI/timing),
	// so load it lazily to keep it out of the initial engine chunk. Splitting
	// per track: only the selected track's theme module is fetched. Attaches
	// to `dressing` when the module resolves; guarded so a disposed bundle
	// (track switched away) never receives stale geometry.
	void import("./scenery")
		.then(({ addScenery }) => {
			if (dressing.userData.disposed) return; // bundle disposed before load
			addScenery(dressing, track, theme);
		})
		.catch(() => {
			// Scenery is decorative; a failed load leaves the track playable.
		});
	for (let i = 0; i < 6; i++) {
		const s = track.samples[Math.floor(i * track.samples.length / 6)];
		const warm = theme.kind === "yard";
		const lamp = new THREE.PointLight(warm ? 16771780 : theme.kind === "core" ? 15785450 : 14018751, theme.kind === "coast" ? 1.05 : 1.35, 28, 2);
		lamp.position.set(s.x + s.rx * (s.width * .5 + 3.2), s.y + 5.2, s.z + s.rz * (s.width * .5 + 3.2));
		dressing.add(lamp);
	}
	// The road receives the tracked sun so cars read as planted. The huge
	// ground disc and the sea do not: a 68 m shadow frustum on a 1900 m plane
	// draws a hard sliding square. Cars and lazy scenery opt in themselves.
	scene.traverse((obj) => {
		const mesh = obj as THREE.Mesh;
		if (!mesh.isMesh || mesh.userData.noShadow) return;
		mesh.receiveShadow = true;
	});
	roadSurfaces.group.traverse((obj) => {
		const mesh = obj as THREE.Mesh;
		if (mesh.isMesh) mesh.receiveShadow = true;
	});
	return {
		scene,
		road: roadSurfaces,
		cars: carsIn.map((entry) => {
			const view = createCarView(entry.color, entry.id, entry.rival);
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
const SHARED_GEOS: Set<THREE.BufferGeometry> = new Set(Object.values(geos));

function disposeMaterialOnce(
	material: THREE.Material,
	seenMaterials: Set<THREE.Material>,
	seenTextures: Set<THREE.Texture>,
): void {
	if (seenMaterials.has(material)) return;
	seenMaterials.add(material);
	for (const value of Object.values(material)) {
		if (!(value instanceof THREE.Texture) || seenTextures.has(value)) continue;
		seenTextures.add(value);
		value.dispose();
	}
	material.dispose();
}

export function releaseObject(root: THREE.Object3D): void {
	const seenGeometries = new Set<THREE.BufferGeometry>();
	const seenMaterials = new Set<THREE.Material>();
	const seenTextures = new Set<THREE.Texture>();
	root.traverse((obj) => {
		const mesh = obj as THREE.Mesh;
		if (mesh.geometry && !SHARED_GEOS.has(mesh.geometry) && !seenGeometries.has(mesh.geometry)) {
			seenGeometries.add(mesh.geometry);
			mesh.geometry.dispose();
		}
		const material = mesh.material;
		if (!material) return;
		const list = Array.isArray(material) ? material : [material];
		for (const mat of list) disposeMaterialOnce(mat, seenMaterials, seenTextures);
	});
}
function underRoad(obj: THREE.Object3D, roadRoot: THREE.Object3D): boolean {
	let p: THREE.Object3D | null = obj;
	while (p) {
		if (p === roadRoot) return true;
		p = p.parent;
	}
	return false;
}

export function disposeBundle(bundle: SceneBundle): void {
	// Road geometries, materials and textures are owned by the road module.
	// Disposing them here and again in the traverse below used to double-free
	// the same GPU resources on every track change.
	bundle.road.dispose();
	// Shadow maps belong to their DirectionalLight and are not scene children
	// with a Mesh material, so scene traversal will never release them.
	const sun = bundle.scene.userData.sun as THREE.DirectionalLight | undefined;
	sun?.shadow.map?.dispose();
	if (sun) sun.shadow.map = null;
	// Mark the dressing group so a pending lazy scenery load (see buildScene)
	// skips attaching geometry to an already-disposed bundle.
	(bundle.dressing as THREE.Group & { userData?: Record<string, unknown> }).userData.disposed = true;
	const seenGeo = new Set<THREE.BufferGeometry>();
	const seenMat = new Set<THREE.Material>();
	const seenTex = new Set<THREE.Texture>();
	const sceneryData = bundle.dressing.userData;
	const ownedSceneryGeometries = sceneryData.ownedSceneryGeometries as THREE.BufferGeometry[] | undefined;
	for (const geometry of ownedSceneryGeometries ?? []) {
		if (SHARED_GEOS.has(geometry) || seenGeo.has(geometry)) continue;
		seenGeo.add(geometry);
		geometry.dispose();
	}
	const ownedSceneryMaterials = sceneryData.ownedSceneryMaterials as THREE.Material[] | undefined;
	for (const material of ownedSceneryMaterials ?? []) disposeMaterialOnce(material, seenMat, seenTex);
	bundle.scene.traverse((obj) => {
		if (underRoad(obj, bundle.road.group)) return;
		const mesh = obj as THREE.Mesh;
		if (mesh.geometry && !SHARED_GEOS.has(mesh.geometry) && !seenGeo.has(mesh.geometry)) {
			seenGeo.add(mesh.geometry);
			mesh.geometry.dispose();
		}
		const material = mesh.material;
		if (!material) return;
		const list = Array.isArray(material) ? material : [material];
		for (const mat of list) disposeMaterialOnce(mat, seenMat, seenTex);
	});
}
/**
 * Visual pose. Two things matter here beyond replaying the physics:
 *
 * 1. The fenders sit only ~7 cm above the tires, so roll and pitch are scaled
 *    to the amount the arch can actually absorb — bigger angles would let the
 *    bodywork cut into the tires. Lateral jacking and the touchdown rebound
 *    carry the rest of the suspension read.
 * 2. Wheels stay planted on the road plane; only in the air do they hang at
 *    full droop, which is what makes a jump look like a car rather than a box.
 */
export function syncCar(view: CarView, car: CarState, pitch: number, vis?: CarVis): void {
	const x = vis ? vis.x : car.x;
	const y = vis ? vis.y : car.y;
	const z = vis ? vis.z : car.z;
	const yaw = vis ? vis.yaw : car.yaw;
	const bodyPitch = vis ? vis.pitch : car.bodyPitch;
	const bodyRoll = vis ? vis.roll : car.bodyRoll;
	const spin = vis ? vis.spin : car.wheelSpin;
	const steer = vis ? vis.steer : car.steerVisual;
	const fx = -Math.sin(yaw);
	const fz = -Math.cos(yaw);
	const now = performance.now();
	const dt = clamp((now - view.stamp) / 1000, 0.001, 0.1);
	view.stamp = now;

	// Body attitude: capped so the arch never meets the tire.
	const roll = clamp(-car.latAccel * 0.0024, -0.034, 0.034);
	const bodyPitchV = clamp(bodyPitch, -0.09, 0.11) * 0.2;
	const latShift = clamp(car.latAccel * 0.0016, -0.02, 0.02);
	void bodyRoll;

	// Wheel droop: full travel in the air, planted on the road.
	const dropTarget = car.airborne ? -0.045 : 0;
	for (let axle = 0; axle < 2; axle++) {
		const pos = view.susp[axle]!;
		const vel = view.suspVel[axle]!;
		const nextVel = vel + ((dropTarget - pos) * 560 - vel * 17) * dt;
		view.suspVel[axle] = nextVel;
		view.susp[axle] = clamp(pos + nextVel * dt, -0.06, 0.03);
	}
	// Touchdown kick: the body dips on landing and rebounds on its spring.
	if (!car.airborne && view.wasAir) view.heaveVel = -0.95;
	view.wasAir = car.airborne;
	view.heaveVel += (-view.heave * 720 - view.heaveVel * 16) * dt;
	view.heave = clamp(view.heave + view.heaveVel * dt, -0.05, 0.03);

	view.root.position.set(x, y, z);
	view.root.up.set(0, 1, 0);
	if (car.airborne) {
		view.root.lookAt(x + fx, y + pitch, z + fz);
		view.chassis.rotation.set(0, 0, roll * 0.6);
	} else {
		// Road plane from the four tire patches: nose-up is negative local X
		// because +Z is the nose, and left-up is positive local Z because +X
		// is the driver's left. Accel pitch/roll stay on the chassis.
		view.root.lookAt(x + fx, y, z + fz);
		view.root.rotateX(-car.gradePitch);
		view.root.rotateZ(car.gradeRoll);
		view.chassis.rotation.set(-bodyPitchV, 0, roll);
	}
	view.chassis.position.set(latShift, view.heave, 0);

	for (let i = 0; i < view.rigs.length; i++) {
		const rig = view.rigs[i]!;
		const drop = view.susp[rig.front ? 0 : 1]!;
		// Residual vs the fitted plane, so a tire on a kerb or a crest still
		// meets its own patch after the body has taken the shared slope.
		const kerb = car.airborne ? 0 : (car.wheelKerb[i] ?? (rig.x >= 0 ? car.kerbL : car.kerbR));
		rig.pivot.position.set(rig.x, rig.y + drop + kerb, rig.z);
		rig.spin.rotation.x = spin * (0.38 / rig.radius);
		rig.blob.visible = !car.airborne;
	}
	view.root.updateMatrixWorld(true);
	if (!car.airborne) {
		for (let i = 0; i < view.rigs.length; i++) {
			const rig = view.rigs[i]!;
			syncWheelContactDecal(view.root, rig.pivot, rig.blob, rig.radius, car.wheelNormals[i]);
		}
	}
	for (const p of view.frontPivots) p.rotation.y = steer * 0.42;
	view.contact.visible = !car.airborne;
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
			color: 9868967,
			size: .82,
			transparent: true,
			opacity: .26,
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
