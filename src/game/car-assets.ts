import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { WHEEL_CONTACT_Y } from "./contact";
import { wheelLayout, type CarId } from "./car-model";

/**
 * Real CC0 bodies for Vector, Vanta and Aegis.
 * The mesh is scaled and moved so its axles sit on the existing wheel layout.
 * Physics positions are never edited to fit a file.
 */

export type CarCorner = "FL" | "FR" | "RL" | "RR";

export type CarLook = {
  body: THREE.Color;
  accent: number;
  hero: boolean;
  quality: "low" | "medium" | "high";
  /** Garage, carousel and the comparison scene stay on the full-detail body. */
  presentation?: boolean;
};

type Slot = "paint" | "glass" | "tire" | "rim" | "lamp" | "tail" | "caliper" | "keep";

type Level = {
  tris: number;
  draws: number;
  body: THREE.Group;
  wheels: Record<CarCorner, THREE.Group>;
  uprights: Record<CarCorner, THREE.Group>;
  radius: Record<CarCorner, number>;
  modelBox: THREE.Box3;
};

type Prepared = {
  lod1: Level;
  lod2: Level;
  fit: { scale: THREE.Vector3; offset: THREE.Vector3 };
};

export type RealCarInstance = {
  lod: THREE.LOD;
  wheels: Record<CarCorner, { spin: THREE.Group; upright: THREE.Group }>;
  bounds: THREE.Box3;
  paint: THREE.MeshPhysicalMaterial;
  brake: THREE.MeshStandardMaterial;
};

export type CarAssetReport = {
  bytes: number;
  loadMs: number;
  textureBytes: number;
  cars: Record<string, { lod1Tris: number; lod2Tris: number; lod1Draws: number; lod2Draws: number }>;
  /** One full-detail car as shown in the garage and the comparison scene. */
  presentation: Record<string, { triangles: number; draws: number }>;
};

const FILES: Record<Exclude<CarId, "surge">, { lod1: string; lod2: string; bytes: number }> = {
  vector: { lod1: "/models/lod1/supercar.glb", lod2: "/models/lod2/supercar.glb", bytes: 2015316 + 332728 },
  vanta: { lod1: "/models/lod1/electric-gt.glb", lod2: "/models/lod2/electric-gt.glb", bytes: 827560 + 114892 },
  aegis: { lod1: "/models/lod1/family-sedan.glb", lod2: "/models/lod2/family-sedan.glb", bytes: 1006584 + 122748 },
};

const CORNERS: CarCorner[] = ["FL", "FR", "RL", "RR"];

const prepared = new Map<string, Prepared>();
const sharedGeos = new Set<THREE.BufferGeometry>();
const sharedTextures = new Set<THREE.Texture>();
const presentation = new Map<string, { triangles: number; draws: number }>();
let ready: Promise<void> | null = null;
let loadMs = 0;

export function isSharedAsset(resource: THREE.BufferGeometry | THREE.Texture): boolean {
  return resource instanceof THREE.BufferGeometry ? sharedGeos.has(resource) : sharedTextures.has(resource);
}

export function carAssetReport(): CarAssetReport {
  const cars: CarAssetReport["cars"] = {};
  let bytes = 0;
  for (const id of Object.keys(FILES) as Array<Exclude<CarId, "surge">>) {
    bytes += FILES[id].bytes;
    const item = prepared.get(id);
    if (!item) continue;
    cars[id] = {
      lod1Tris: item.lod1.tris,
      lod2Tris: item.lod2.tris,
      lod1Draws: item.lod1.draws,
      lod2Draws: item.lod2.draws,
    };
  }
  const shown: CarAssetReport["presentation"] = {};
  for (const [id, stat] of presentation) shown[id] = stat;
  return { bytes, loadMs, textureBytes: sharedTextureBytes(), cars, presentation: shown };
}

function sharedTextureBytes(): number {
  let bytes = 0;
  for (const tex of sharedTextures) {
    const compressed = tex as THREE.CompressedTexture;
    if (compressed.isCompressedTexture && compressed.mipmaps) {
      for (const mip of compressed.mipmaps) bytes += mip.data?.byteLength ?? 0;
      continue;
    }
    const image = tex.image as { width?: number; height?: number } | undefined;
    if (image?.width && image.height) bytes += image.width * image.height * 4;
  }
  return bytes;
}

export function hasRealCar(vehicleId: string): boolean {
  return prepared.has(vehicleId);
}

export function preloadCarModels(renderer: THREE.WebGLRenderer): Promise<void> {
  if (!ready) ready = loadAll(renderer);
  return ready;
}

async function loadAll(renderer: THREE.WebGLRenderer): Promise<void> {
  const ktx2 = new KTX2Loader();
  ktx2.setTranscoderPath("/basis/");
  ktx2.detectSupport(renderer);
  await MeshoptDecoder.ready;
  const loader = new GLTFLoader();
  loader.setKTX2Loader(ktx2);
  loader.setMeshoptDecoder(MeshoptDecoder);
  const started = performance.now();
  try {
    for (const id of Object.keys(FILES) as Array<Exclude<CarId, "surge">>) {
      const file = FILES[id];
      const [lod1, lod2] = await Promise.all([
        loader.loadAsync(file.lod1).then((gltf) => buildLevel(gltf.scene, id)),
        loader.loadAsync(file.lod2).then((gltf) => buildLevel(gltf.scene, id)),
      ]);
      prepared.set(id, { lod1, lod2, fit: fitOf(id, lod1) });
    }
    loadMs = performance.now() - started;
  } finally {
    ktx2.dispose();
  }
}

function fitOf(id: Exclude<CarId, "surge">, level: Level): { scale: THREE.Vector3; offset: THREE.Vector3 } {
  const layout = wheelLayout(id);
  const front = level.wheels.FL;
  const rear = level.wheels.RL;
  const frontPos = front.userData.axle as THREE.Vector3;
  const rearPos = rear.userData.axle as THREE.Vector3;
  const modelWb = frontPos.z - rearPos.z;
  const modelTrack = (Math.abs(frontPos.x) + Math.abs(rearPos.x)) / 2;
  const physTrack = (layout.frontX + layout.rearX) / 2;
  const scaleZ = modelWb > 0.01 ? layout.wheelbase / modelWb : 1;
  const scaleX = modelTrack > 0.01 ? physTrack / modelTrack : scaleZ;
  const scaleY = scaleZ;
  const drop = id === "aegis" ? 0.055 : id === "vanta" ? 0.03 : 0;
  const offsetZ = layout.frontZ - frontPos.z * scaleZ;
  return {
    scale: new THREE.Vector3(scaleX, scaleY, scaleZ),
    offset: new THREE.Vector3(0, WHEEL_CONTACT_Y - drop, offsetZ),
  };
}

function buildLevel(root: THREE.Object3D, id: Exclude<CarId, "surge">): Level {
  root.updateMatrixWorld(true);
  const wheels = {} as Record<CarCorner, THREE.Group>;
  const uprights = {} as Record<CarCorner, THREE.Group>;
  const radius = {} as Record<CarCorner, number>;
  for (const corner of CORNERS) {
    const taken = takeCorner(root, corner);
    wheels[corner] = taken.wheel;
    uprights[corner] = taken.upright;
    radius[corner] = taken.radius;
  }
  const skipSpoiler = id === "vanta";
  let tris = 0;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const slot = slotOf(mesh.name || "", material?.name || "", skipSpoiler);
    mesh.userData.slot = slot;
    if (slot === "skip" || /plate/i.test(mesh.name) || (skipSpoiler && /spoiler/i.test(mesh.name))) mesh.visible = false;
    tris += triCount(mesh.geometry);
  });
  markShared(root);
  root.updateMatrixWorld(true);
  const modelBox = new THREE.Box3().setFromObject(root);
  const body = root as THREE.Group;
  body.name = "imported-body";
  for (const corner of CORNERS) tris += countGroup(wheels[corner]) + countGroup(uprights[corner]);
  const draws = countMeshes(body) + CORNERS.length * 2;
  return { tris, draws, body, wheels, uprights, radius, modelBox };
}

function takeCorner(root: THREE.Object3D, corner: CarCorner): { wheel: THREE.Group; upright: THREE.Group; radius: number } {
  const hub = root.getObjectByName(`wheel_${corner}`);
  const wheel = new THREE.Group();
  wheel.name = `wheel-${corner}`;
  const upright = new THREE.Group();
  upright.name = `upright-${corner}`;
  if (!hub) {
    wheel.userData.axle = new THREE.Vector3();
    return { wheel, upright, radius: 0.33 };
  }
  hub.updateWorldMatrix(true, false);
  const axle = new THREE.Vector3();
  hub.getWorldPosition(axle);
  wheel.userData.axle = axle;
  const box = new THREE.Box3().setFromObject(hub);
  const radius = Math.max(box.max.y - axle.y, axle.y - box.min.y, 0.2);
  const hubQuat = hub.quaternion.clone();
  hub.removeFromParent();
  hub.position.set(0, 0, 0);
  hub.quaternion.copy(hubQuat);
  wheel.add(hub);

  const caliper = root.getObjectByName(`caliper_${corner}`);
  if (caliper) {
    caliper.updateWorldMatrix(true, true);
    const axleOnly = new THREE.Matrix4().setPosition(axle);
    const rel = new THREE.Matrix4().multiplyMatrices(axleOnly.invert(), caliper.matrixWorld);
    caliper.removeFromParent();
    rel.decompose(caliper.position, caliper.quaternion, caliper.scale);
    upright.add(caliper);
  }
  markShared(wheel);
  markShared(upright);
  return { wheel, upright, radius };
}

function slotOf(meshName: string, matName: string, skipSpoiler: boolean): Slot | "skip" {
  const mesh = meshName.toLowerCase();
  const mat = matName.toLowerCase();
  const both = `${mesh} ${mat}`;
  if (/plate|license|licence/.test(both)) return "skip";
  if (skipSpoiler && /spoiler/.test(mesh)) return "skip";
  if (/tire/.test(both)) return "tire";
    if (/rim_|rim\b|hub|bolt/.test(both)) return "rim";
  if (/caliper/.test(both)) return "caliper";
  if (/light_rear|lens_red|lamp_red|reflector_red|taillamp/.test(both)) return "tail";
  if (/light_front|light_drl|lamp_amber|projector|headlamp|light_amber/.test(both) && !/housing/.test(both)) return "lamp";
  if (/glass|windshield|window/.test(both) && !/mirror/.test(both)) return "glass";
  if (/\bpaint\b|paint_body/.test(both)) return "paint";
  return "keep";
}

function countMeshes(group: THREE.Object3D): number {
  let n = 0;
  group.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) n += 1;
  });
  return n;
}

function triCount(geo: THREE.BufferGeometry): number {
  const index = geo.getIndex();
  return (index ? index.count : geo.getAttribute("position")?.count ?? 0) / 3;
}

function countGroup(group: THREE.Object3D): number {
  let tris = 0;
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) tris += triCount(mesh.geometry);
  });
  return tris;
}

function markShared(group: THREE.Object3D): void {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    sharedGeos.add(mesh.geometry);
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of list) if (material) retainTextures(material);
  });
}

function retainTextures(material: THREE.Material): void {
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture) sharedTextures.add(value);
  }
}

export function instantiateRealCar(vehicleId: string, look: CarLook): RealCarInstance | null {
  const item = prepared.get(vehicleId);
  if (!item) return null;
  const layout = wheelLayout(vehicleId);
  const materials = new Map<string, THREE.Material>();
  const paint = makePaint(look, paintNormal(item.lod1));
  const brake = makeTail(look);
  const lod = new THREE.LOD();
  const showFull = look.presentation === true || look.quality !== "low";
  const levels: Array<[Level, number]> = look.presentation
    ? [[item.lod1, 0]]
    : [
        [item.lod1, 0],
        [item.lod2, look.quality === "low" ? 0 : 18],
      ];
  for (const [level, distance] of levels) {
    const holder = new THREE.Group();
    holder.scale.copy(item.fit.scale);
    holder.position.copy(item.fit.offset);
    const clone = level.body.clone(true);
    assignMaterials(clone, materials, look, paint, brake);
    holder.add(clone);
    if (vehicleId === "vanta" || vehicleId === "aegis") mountRaceKit(holder, vehicleId, level.modelBox, look.accent);
    if (vehicleId === "vector") mountVectorIdentity(holder, level.modelBox, look.accent);
    lod.addLevel(holder, distance, 0.15);
  }
  const wheels = {} as RealCarInstance["wheels"];
  const wheelLevel = showFull ? item.lod1 : item.lod2;
  for (const corner of CORNERS) {
    const physR = corner.startsWith("F") ? layout.frontRadius : layout.rearRadius;
    const refR = item.lod1.radius[corner] || wheelLevel.radius[corner] || physR;
    const sourceR = wheelLevel.radius[corner] || refR;
    const visualR = refR * item.fit.scale.y;
    const correct = sourceR > 0.01 ? refR / sourceR : 1;
    const spin = new THREE.Group();
    spin.position.y = visualR - physR;
    spin.scale.set(item.fit.scale.x * correct, item.fit.scale.y * correct, item.fit.scale.y * correct);
    const wheel = wheelLevel.wheels[corner].clone(true);
    assignMaterials(wheel, materials, look, paint, brake);
    spin.add(wheel);
    const upright = new THREE.Group();
    upright.position.y = visualR - physR;
    upright.scale.copy(spin.scale);
    const cal = wheelLevel.uprights[corner].clone(true);
    assignMaterials(cal, materials, look, paint, brake);
    upright.add(cal);
    wheels[corner] = { spin, upright };
  }
  lod.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(lod);
  if (look.presentation) presentation.set(vehicleId, countVisible(lod));
  return { lod, wheels, bounds, paint, brake };
}

function countVisible(root: THREE.Object3D): { triangles: number; draws: number } {
  let triangles = 0;
  let draws = 0;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    draws += 1;
    triangles += triCount(mesh.geometry);
  });
  return { triangles, draws };
}

function paintNormal(level: Level): THREE.Texture | null {
  let map: THREE.Texture | null = null;
  level.body.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (map || !mesh.isMesh || mesh.userData.slot !== "paint") return;
    map = (mesh.material as THREE.MeshStandardMaterial).normalMap ?? null;
  });
  return map;
}

function assignMaterials(
  root: THREE.Object3D,
  cache: Map<string, THREE.Material>,
  look: CarLook,
  paint: THREE.MeshPhysicalMaterial,
  brake: THREE.MeshStandardMaterial,
): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const source = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material;
    const slot = (mesh.userData.slot as Slot | undefined) ?? slotOf(mesh.name || "", source?.name || "", false);
    if (!source) return;
    if (slot === "skip") {
      mesh.visible = false;
      return;
    }
    if (slot === "paint") {
      mesh.material = paint;
    } else if (slot === "tail") {
      mesh.material = brake;
    } else {
      const key = `${slot}:${source.uuid}`;
      let mat = cache.get(key);
      if (!mat) {
        mat = materialFor(slot, source, look);
        cache.set(key, mat);
      }
      mesh.material = mat;
    }
    mesh.castShadow = slot !== "glass";
    mesh.receiveShadow = true;
  });
}

function makePaint(look: CarLook, normalMap: THREE.Texture | null): THREE.MeshPhysicalMaterial {
  if (normalMap) sharedTextures.add(normalMap);
  if (look.quality === "low") {
    return new THREE.MeshStandardMaterial({
      color: look.body,
      normalMap,
      roughness: 0.46,
      metalness: 0.32,
      envMapIntensity: 0.35,
      emissive: look.accent,
      emissiveIntensity: 0.02,
    }) as unknown as THREE.MeshPhysicalMaterial;
  }
  return new THREE.MeshPhysicalMaterial({
    color: look.body,
    normalMap,
    roughness: 0.34,
    metalness: 0.4,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    envMapIntensity: 0.55,
    emissive: look.accent,
    emissiveIntensity: 0.03,
  });
}

function makeTail(look: CarLook): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x3a0d16,
    emissive: 0xff2438,
    emissiveIntensity: look.hero ? 0.55 : 0.4,
    roughness: 0.28,
    metalness: 0.12,
  });
}

function materialFor(slot: Slot, source: THREE.Material, look: CarLook): THREE.Material {
  const std = source as THREE.MeshStandardMaterial;
  if (slot === "keep") {
    const clone = source.clone();
    retainTextures(clone);
    return clone;
  }
  if (slot === "glass") {
    return new THREE.MeshPhysicalMaterial({
      color: 0x101820,
      roughness: 0.04,
      metalness: 0.08,
      transparent: true,
      opacity: 0.62,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      envMapIntensity: 1.2,
      depthWrite: true,
      side: THREE.DoubleSide,
    });
  }
  if (slot === "tire") {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x141519,
      map: std.map ?? null,
      normalMap: std.normalMap ?? null,
      roughness: 0.94,
      metalness: 0,
      envMapIntensity: 0.3,
    });
    retainTextures(mat);
    return mat;
  }
  if (slot === "rim") {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xd5dee6,
      normalMap: std.normalMap ?? null,
      roughness: 0.28,
      metalness: 0.92,
      envMapIntensity: 1,
    });
    retainTextures(mat);
    return mat;
  }
  if (slot === "lamp") {
    return new THREE.MeshStandardMaterial({
      color: 0xdfe9f5,
      emissive: 0xf4f8ff,
      emissiveIntensity: look.hero ? 1.15 : 0.8,
      roughness: 0.16,
      metalness: 0.05,
    });
  }
  if (slot === "caliper") {
    return new THREE.MeshStandardMaterial({
      color: look.accent,
      roughness: 0.34,
      metalness: 0.45,
      emissive: look.accent,
      emissiveIntensity: 0.12,
      envMapIntensity: 0.8,
    });
  }
  const clone = source.clone();
  retainTextures(clone);
  return clone;
}

export function mountRaceKit(parent: THREE.Object3D, vehicleId: string, bounds: THREE.Box3, accent: number): void {
  if (vehicleId !== "vanta" && vehicleId !== "aegis") return;
  const tcr = vehicleId === "aegis";
  const carbon = new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.42, metalness: 0.55, envMapIntensity: 0.6 });
  const edge = new THREE.MeshStandardMaterial({
    color: 0x0c0e12,
    emissive: accent,
    emissiveIntensity: 0.45,
    roughness: 0.35,
    metalness: 0.3,
  });
  const half = Math.min(bounds.max.x * 0.92, tcr ? 0.98 : 0.9);
  const nose = bounds.max.z - (tcr ? 0.28 : 0.18);
  const bladeY = Math.max(bounds.min.y + 0.08, 0.1);
  const depth = tcr ? 0.16 : 0.11;
  const blade = new THREE.Mesh(splitterBlade(half * 2, depth), carbon);
  blade.position.set(0, bladeY, nose - depth);
  blade.castShadow = true;
  parent.add(blade);
  for (const side of [-1, 1]) {
    const skirtLen = (bounds.max.z - bounds.min.z) * 0.46;
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.04, skirtLen), carbon);
    skirt.position.set(side * (bounds.max.x - 0.02), bladeY + 0.05, (bounds.max.z + bounds.min.z) * 0.05);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.012, skirtLen * 0.92), edge);
    stripe.position.set(side * (bounds.max.x + 0.004), bladeY + 0.07, skirt.position.z);
    parent.add(skirt, stripe);
  }

  const trunk = trunkDeck(parent.children[0], parent);
  const deckY = trunk.y;
  const wingZ = trunk.z;
  const rise = tcr ? 0.22 : 0.12;
  const span = half * (tcr ? 1.7 : 1.4);
  const wing = new THREE.Mesh(airfoil(span, tcr ? 0.24 : 0.18, 0.02), carbon);
  wing.position.set(0, deckY + rise, wingZ);
  wing.castShadow = true;
  parent.add(wing);
  for (const side of [-1, 1]) {
    const neck = new THREE.Mesh(swanNeck(rise), carbon);
    neck.position.set(side * Math.min(0.26, span * 0.16), deckY - 0.015, wingZ + 0.02);
    neck.castShadow = true;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.012, 0.1), carbon);
    foot.position.set(neck.position.x, deckY, wingZ + 0.02);
    parent.add(neck, foot);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.012, tcr ? 0.1 : 0.065, tcr ? 0.2 : 0.14), carbon);
    plate.position.set(side * span * 0.5, deckY + rise, wingZ);
    parent.add(plate);
  }
}

function mountVectorIdentity(parent: THREE.Object3D, bounds: THREE.Box3, accent: number): void {
  const neon = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xf7fdff,
    emissiveIntensity: 2.4,
    roughness: 0.15,
    toneMapped: false,
  });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x121418, roughness: 0.4, metalness: 0.6 });
  const body = parent.children[0];
  const lamps = slotCenters(body, parent, "lamp").filter((p) => p.z > 0.2);
  const used = lamps.length > 0 ? lamps : [new THREE.Vector3(0.55, 0.48, bounds.max.z - 0.45), new THREE.Vector3(-0.55, 0.48, bounds.max.z - 0.45)];
  for (const lamp of used) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.03, 0.016), neon);
    blade.position.set(lamp.x, lamp.y, lamp.z + 0.045);
    parent.add(blade);
  }
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.014, 0.62), carbon);
  spine.position.set(0, bounds.max.y * 0.5, bounds.max.z - 0.95);
  const inlay = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.008, 0.48), neon);
  inlay.position.set(0, spine.position.y + 0.01, spine.position.z);
  parent.add(spine, inlay);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.014, 0.028), neon);
  lip.position.set(0, 0.22, bounds.max.z - 0.22);
  parent.add(lip);
  const tailMat = neon.clone();
  tailMat.emissive = new THREE.Color(accent);
  const tail = bounds.min.z;
  const tailBar = new THREE.Mesh(new THREE.BoxGeometry(Math.min(1.5, bounds.max.x * 1.2), 0.022, 0.012), tailMat);
  tailBar.position.set(0, bounds.max.y * 0.32, tail + 0.08);
  parent.add(tailBar);
  for (const x of [-0.28, -0.1, 0.1, 0.28]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.06, 0.14), carbon);
    fin.position.set(x, 0.2, tail + 0.18);
    parent.add(fin);
  }
}

function slotCenters(body: THREE.Object3D | undefined, holder: THREE.Object3D, slot: string): THREE.Vector3[] {
  if (!body) return [];
  holder.updateWorldMatrix(true, true);
  const inv = holder.matrixWorld.clone().invert();
  const found: THREE.Vector3[] = [];
  body.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.slot !== slot) return;
    const box = new THREE.Box3().setFromObject(mesh);
    if (box.isEmpty()) return;
    found.push(box.getCenter(new THREE.Vector3()).applyMatrix4(inv));
  });
  return found;
}

function trunkDeck(body: THREE.Object3D | undefined, holder: THREE.Object3D): { y: number; z: number } {
  const fallback = { y: 0.85, z: -1.6 };
  if (!body) return fallback;
  holder.updateWorldMatrix(true, true);
  const inv = holder.matrixWorld.clone().invert();
  const pts: Array<{ y: number; z: number }> = [];
  const v = new THREE.Vector3();
  body.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.slot !== "paint") return;
    const pos = mesh.geometry.getAttribute("position");
    if (!pos) return;
    const step = Math.max(1, Math.floor(pos.count / 500));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(inv);
      if (Math.abs(v.x) > 0.4 || v.z > -0.9 || v.y < 0.45 || v.y > 1.2) continue;
      pts.push({ y: v.y, z: v.z });
    }
  });
  if (pts.length < 8) return fallback;
  pts.sort((a, b) => a.z - b.z);
  const rear = pts.slice(0, Math.max(8, Math.floor(pts.length * 0.35)));
  rear.sort((a, b) => a.y - b.y);
  const mid = rear[Math.floor(rear.length * 0.45)]!;
  return { y: mid.y, z: mid.z };
}

function splitterBlade(width: number, depth: number): THREE.BufferGeometry {
  const half = width / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-half * 0.96, 0);
  shape.lineTo(half * 0.96, 0);
  shape.quadraticCurveTo(half * 0.72, depth * 0.45, half * 0.28, depth * 0.82);
  shape.quadraticCurveTo(0, depth, -half * 0.28, depth * 0.82);
  shape.quadraticCurveTo(-half * 0.72, depth * 0.45, -half * 0.96, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.014, bevelEnabled: false, curveSegments: 8 });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0.007, 0);
  geo.computeVertexNormals();
  return geo;
}

function swanNeck(rise: number): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0.05),
    new THREE.Vector3(0, rise * 0.25, 0.03),
    new THREE.Vector3(0, rise * 0.62, -0.01),
    new THREE.Vector3(0, rise, -0.045),
  ]);
  const geo = new THREE.TubeGeometry(curve, 10, 0.016, 6, false);
  geo.computeVertexNormals();
  return geo;
}

function airfoil(span: number, chord: number, thick: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(chord * 0.3, thick, chord * 0.72, thick * 0.62, chord, thick * 0.08);
  shape.lineTo(chord * 0.9, -thick * 0.1);
  shape.bezierCurveTo(chord * 0.5, -thick * 0.3, chord * 0.18, -thick * 0.08, 0, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: span, bevelEnabled: false, curveSegments: 6, steps: 1 });
  geo.translate(-chord * 0.32, 0, -span / 2);
  geo.rotateY(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}
