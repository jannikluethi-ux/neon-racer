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
  // Visual body drop only. The arch crown is already close to the tyre, so this
  // is the extra ride-height the fender can take before the tyre meets the lip.
  const drop = id === "aegis" ? 0.078 : id === "vanta" ? 0.052 : 0;
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
  if (id === "vector") editVectorMesh(root);
  const skipSpoiler = id === "vanta";
  let tris = 0;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const slot = slotOf(mesh.name || "", material?.name || "", skipSpoiler);
    mesh.userData.slot = slot;
    if (slot === "skip" || /plate/i.test(mesh.name) || (skipSpoiler && /spoiler/i.test(mesh.name))) mesh.visible = false;
    if (id === "vector" && /^(wing|wing_skin)$/i.test(obj.name)) obj.visible = false;
    tris += triCount(mesh.geometry);
  });
  markShared(root);
  root.updateMatrixWorld(true);
  const modelBox = new THREE.Box3();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh && mesh.visible) modelBox.expandByObject(mesh);
  });
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
    if (vehicleId === "vector") mountVectorIdentity(holder, level.modelBox, look.accent, paint);
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

const kitGeos = new Map<string, THREE.BufferGeometry>();

function pooled(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let geo = kitGeos.get(key);
  if (!geo) {
    geo = build();
    sharedGeos.add(geo);
    kitGeos.set(key, geo);
  }
  return geo;
}

function addPart(parent: THREE.Object3D, name: string, geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function mountRaceKit(parent: THREE.Object3D, vehicleId: string, bounds: THREE.Box3, accent: number): void {
  if (vehicleId !== "vanta" && vehicleId !== "aegis") return;
  const tcr = vehicleId === "aegis";
  const body = parent.children[0];
  const carbon = new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.42, metalness: 0.55, envMapIntensity: 0.6 });
  const gurneyMat = new THREE.MeshStandardMaterial({
    color: 0x101216,
    emissive: accent,
    emissiveIntensity: 0.4,
    roughness: 0.35,
    metalness: 0.25,
  });
  const bladeY = Math.max(0.1, bounds.min.y + 0.08);
  const face = bumperFace(body, parent, bladeY, bladeY + (tcr ? 0.28 : 0.22));
  const lead = tcr ? 0.07 : 0.03;
  const bladeKey = `${vehicleId}:splitter:${face.back.toFixed(2)}:${lead}`;
  const blade = addPart(parent, "kit-splitter", pooled(bladeKey, () => splitterFromFace(face, lead)), carbon, 0, bladeY, face.back);
  blade.castShadow = true;

  // Sills sit between the arches. bounds.max.x includes the mirrors, and a
  // skirt hung on that width is the pair of black squares beside Aegis's rear tyres.
  const sill = sillSpan(body, parent, bladeY + 0.04, 0.42);
  if (sill) {
    const skirtGeo = pooled(`${vehicleId}:skirt:${sill.len.toFixed(2)}`, () => new THREE.BoxGeometry(0.028, 0.045, sill.len));
    for (const side of [-1, 1]) {
      addPart(parent, "kit-skirt", skirtGeo, carbon, side * (sill.x - 0.012), bladeY + 0.03, sill.z);
    }
  }

  // Lid positions measured on the source meshes. The bounding box's rear face
  // is the bumper, and a wing hung on that face sits behind the car.
  const trunk = tcr ? { y: 0.98, z: -1.95 } : { y: 0.96, z: -1.82 };
  const deckY = trunk.y;
  const chord = tcr ? 0.3 : 0.22;
  const thick = tcr ? 0.048 : 0.038;
  const rise = tcr ? 0.22 : 0.15;
  const wingZ = trunk.z;
  const span = Math.min(tcr ? 1.72 : 1.28, Math.max(0.8, sill ? sill.x * 2.05 : 1.2));
  const wingKey = `${vehicleId}:wing:${span.toFixed(2)}:${chord}`;
  addPart(parent, "kit-wing", pooled(wingKey, () => wingPlane(span, chord, thick)), carbon, 0, deckY + rise, wingZ);
  const gurney = pooled(`${vehicleId}:gurney:${span.toFixed(2)}`, () => new THREE.BoxGeometry(span * 0.92, 0.012, 0.012));
  addPart(parent, "kit-gurney", gurney, gurneyMat, 0, deckY + rise + thick * 0.46, wingZ - chord * 0.4);
  const mountX = Math.min(tcr ? 0.34 : 0.26, span * 0.22);
  const neck = pooled(`${vehicleId}:neck:${rise.toFixed(2)}`, () => swanNeck(rise - thick * 0.2, tcr ? 0.16 : 0.1, tcr ? 0.032 : 0.026));
  const foot = pooled(`${vehicleId}:foot`, () => new THREE.BoxGeometry(tcr ? 0.14 : 0.11, 0.018, tcr ? 0.18 : 0.14));
  const plateH = tcr ? 0.16 : 0.11;
  const plate = pooled(`${vehicleId}:endplate:${plateH}`, () => new THREE.BoxGeometry(0.016, plateH, chord + 0.02));
  for (const side of [-1, 1]) {
    addPart(parent, "kit-neck", neck, carbon, side * mountX, deckY - 0.01, wingZ + chord * 0.22);
    addPart(parent, "kit-foot", foot, carbon, side * mountX, deckY + 0.002, wingZ + chord * 0.28);
    addPart(parent, "kit-endplate", plate, carbon, side * (span * 0.5 + 0.004), deckY + rise, wingZ);
  }
}

function mountVectorIdentity(parent: THREE.Object3D, bounds: THREE.Box3, accent: number, _paint: THREE.Material): void {
  const carbon = new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.4, metalness: 0.62 });
  const neon = new THREE.MeshStandardMaterial({
    color: 0xf4fbff,
    emissive: accent,
    emissiveIntensity: 1.8,
    roughness: 0.18,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x07080b, roughness: 0.5, metalness: 0.4 });
  const deckY = 0.92;
  const wingZ = -1.72;
  const rise = 0.24;
  const chord = 0.28;
  const span = 1.42;
  addPart(parent, "vec-wing", pooled("vector:wing", () => wingPlane(span, chord, 0.046)), carbon, 0, deckY + rise, wingZ);
  const neck = pooled("vector:neck", () => swanNeck(rise - 0.02, 0.14, 0.03));
  const foot = pooled("vector:foot", () => new THREE.BoxGeometry(0.12, 0.018, 0.16));
  const plate = pooled("vector:endplate", () => new THREE.BoxGeometry(0.016, 0.15, chord + 0.02));
  for (const side of [-1, 1]) {
    addPart(parent, "vec-neck", neck, carbon, side * 0.26, deckY - 0.01, wingZ + 0.08);
    addPart(parent, "vec-foot", foot, carbon, side * 0.26, deckY + 0.002, wingZ + 0.12);
    addPart(parent, "vec-endplate", plate, carbon, side * (span * 0.5 + 0.004), deckY + rise, wingZ);
  }
  const diffuser = pooled("vector:diffuser", () => new THREE.BoxGeometry(0.95, 0.07, 0.32));
  addPart(parent, "vec-diffuser", diffuser, carbon, 0, 0.2, bounds.min.z + 0.22);
  const bar = pooled("vector:tailbar", () => new THREE.BoxGeometry(1.35, 0.035, 0.02));
  addPart(parent, "vec-tailbar", bar, neon, 0, 0.7, bounds.min.z + 0.06);
  const housingBar = pooled("vector:tail-housing", () => new THREE.BoxGeometry(1.45, 0.07, 0.03));
  addPart(parent, "vec-tail-housing", housingBar, dark, 0, 0.7, bounds.min.z + 0.08);
  for (const x of [-0.32, -0.12, 0.12, 0.32]) {
    const fin = pooled("vector:fin", () => new THREE.BoxGeometry(0.016, 0.08, 0.22));
    addPart(parent, "vec-fin", fin, carbon, x, 0.24, bounds.min.z + 0.2);
  }
}

/** Chord runs along Z, thickness along Y, span along X. The leading edge is +Z. */
function wingPlane(span: number, chord: number, thick: number): THREE.BufferGeometry {
  const upper: Array<[number, number]> = [];
  const lower: Array<[number, number]> = [];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const z = chord * (0.5 - t);
    const camber = thick * 0.15 * Math.sin(Math.PI * t);
    const half = thick * (0.12 + 0.38 * Math.sin(Math.PI * Math.pow(t, 0.65)));
    upper.push([z, camber + half]);
    lower.push([z, camber - half * 0.72]);
  }
  const ring = upper.concat(lower.reverse());
  const geo = new THREE.BufferGeometry();
  const pos: number[] = [];
  const index: number[] = [];
  const halfSpan = span / 2;
  for (const x of [-halfSpan, halfSpan]) {
    for (const [z, y] of ring) pos.push(x, y, z);
  }
  const count = ring.length;
  for (let i = 0; i < count; i++) {
    const i2 = (i + 1) % count;
    index.push(i, count + i, count + i2, i, count + i2, i2);
  }
  const cap = (start: number, flip: boolean) => {
    for (let i = 1; i < count - 1; i++) {
      index.push(start, start + (flip ? i + 1 : i), start + (flip ? i : i + 1));
    }
  };
  cap(0, false);
  cap(count, true);
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

function editVectorMesh(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || /wheel|caliper|steering/i.test(mesh.name)) return;
    const geo = mesh.geometry.clone();
    const source = geo.getAttribute("position");
    if (!source) return;
    const floats = new Float32Array(source.count * 3);
    for (let i = 0; i < source.count; i++) {
      floats[i * 3] = source.getX(i);
      floats[i * 3 + 1] = source.getY(i);
      floats[i * 3 + 2] = source.getZ(i);
    }
    const pos = new THREE.BufferAttribute(floats, 3);
    geo.setAttribute("position", pos);
    const world = mesh.matrixWorld;
    const inv = world.clone().invert();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(world);
      deformVector(v);
      v.applyMatrix4(inv);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
    geo.morphAttributes = {};
    mesh.morphTargetInfluences = [];
    mesh.morphTargetDictionary = {};
    const index = geo.getIndex();
    if (index && geo.groups.length) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const keep: number[] = [];
      const groups: Array<{ start: number; count: number; materialIndex: number }> = [];
      for (const g of geo.groups) {
        const materialIndex = g.materialIndex ?? 0;
        const matName = mats[materialIndex]?.name || "";
        let z = 0;
        let n = 0;
        const step = Math.max(1, Math.floor(g.count / 24));
        for (let i = g.start; i < g.start + g.count; i += step) {
          z += v.fromBufferAttribute(pos, index.getX(i)).applyMatrix4(world).z;
          n += 1;
        }
        if (dropLamp(matName, mesh.name, n ? z / n : 0)) continue;
        const start = keep.length;
        for (let i = g.start; i < g.start + g.count; i++) keep.push(index.getX(i));
        if (keep.length > start) groups.push({ start, count: keep.length - start, materialIndex });
      }
      geo.setIndex(keep);
      geo.clearGroups();
      for (const g of groups) geo.addGroup(g.start, g.count, g.materialIndex);
    }
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    mesh.geometry = geo;
  });
}

/** Pull the wedge into a short upright nose and fill the cabin-forward slope. */
function deformVector(v: THREE.Vector3): void {
  if (v.z > 0.9) {
    const u = Math.min(1, (v.z - 0.9) / 1.35);
    v.z = 0.9 + u * 0.62;
    if (v.y < 0.9) {
      const t = Math.min(1, Math.max(0, (v.y - 0.04) / 0.7));
      const ny = 0.42 + t * 0.26;
      v.y = v.y * (1 - u * 0.92) + ny * (u * 0.92);
    }
    const limit = 0.98 - u * 0.18;
    const ax = Math.abs(v.x);
    if (ax > limit) v.x = Math.sign(v.x) * (limit + (ax - limit) * 0.2);
  }
  if (v.z > 0.35 && v.z < 1.35 && v.y > 0.55 && Math.abs(v.x) < 0.32) {
    const along = Math.sin(Math.PI * Math.min(1, Math.max(0, (v.z - 0.35) / 0.9)));
    v.y += 0.06 * along * Math.exp(-(v.x * v.x) / 0.014);
  }
}

function dropLamp(matName: string, meshName: string, z: number): boolean {
  if (/^(light_front|light_drl|light_rear|lens_red|reflector_red|lamp_housing)$/.test(matName)) return true;
  if (matName === "lens_clear" && z > 0.4) return true;
  if (matName === "glass" && meshName.startsWith("details")) return true;
  return false;
}

function localPoint(
  index: number,
  pos: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  target: THREE.Vector3,
  mesh: THREE.Mesh,
  inv: THREE.Matrix4,
): THREE.Vector3 {
  return target.fromBufferAttribute(pos, index).applyMatrix4(mesh.matrixWorld).applyMatrix4(inv);
}

function bumperFace(body: THREE.Object3D | undefined, holder: THREE.Object3D, y0: number, y1: number): { pts: Array<[number, number]>; back: number } {
  const cols = new Map<number, number>();
  const v = new THREE.Vector3();
  holder.updateWorldMatrix(true, true);
  const inv = holder.matrixWorld.clone().invert();
  if (body) {
    body.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.visible) return;
      if (/wheel|caliper|plate|glass|interior/i.test(mesh.name)) return;
      const pos = mesh.geometry.getAttribute("position");
      if (!pos) return;
      const step = Math.max(1, Math.floor(pos.count / 2500));
      for (let i = 0; i < pos.count; i += step) {
        localPoint(i, pos, v, mesh, inv);
        if (v.y < y0 || v.y > y1 || v.z < 0.8) continue;
        const bin = Math.round(v.x * 20) / 20;
        const prev = cols.get(bin);
        if (prev === undefined || v.z > prev) cols.set(bin, v.z);
      }
    });
  }
  const pts = [...cols.entries()].sort((a, b) => a[0] - b[0]).map(([x, z]): [number, number] => [x, z]);
  const back = pts.length ? Math.min(...pts.map((p) => p[1])) - 0.04 : 1.4;
  return { pts, back };
}

function splitterFromFace(face: { pts: Array<[number, number]>; back: number }, lead: number): THREE.BufferGeometry {
  const pts = face.pts.filter((p) => Math.abs(p[0]) < 1.05);
  const shape = new THREE.Shape();
  if (pts.length < 4) {
    shape.moveTo(-0.5, 0);
    shape.lineTo(0.5, 0);
    shape.lineTo(0.2, 0.06);
    shape.lineTo(-0.2, 0.06);
  } else {
    const half = Math.max(...pts.map((p) => Math.abs(p[0]))) || 1;
    shape.moveTo(pts[0][0] * 0.96, 0);
    for (const [x, z] of pts) {
      const t = 1 - Math.min(1, Math.abs(x) / half);
      const forward = Math.max(0, z - face.back) + lead * t * t;
      shape.lineTo(x * 0.97, Math.max(0.005, forward));
    }
    shape.lineTo(pts[pts.length - 1][0] * 0.96, 0);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.016, bevelEnabled: false, curveSegments: 1 });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0.008, 0);
  geo.computeVertexNormals();
  return geo;
}

function sillSpan(body: THREE.Object3D | undefined, holder: THREE.Object3D, y0: number, y1: number): { x: number; z: number; len: number } | null {
  if (!body) return null;
  holder.updateWorldMatrix(true, true);
  const inv = holder.matrixWorld.clone().invert();
  let maxX = 0;
  let z0 = 0;
  let z1 = 0;
  let n = 0;
  const v = new THREE.Vector3();
  body.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    if (/wheel|caliper|plate|mirror|glass/i.test(mesh.name)) return;
    const pos = mesh.geometry.getAttribute("position");
    if (!pos) return;
    const step = Math.max(1, Math.floor(pos.count / 2000));
    for (let i = 0; i < pos.count; i += step) {
      localPoint(i, pos, v, mesh, inv);
      if (v.y < y0 || v.y > y1 || Math.abs(v.z) > 0.7) continue;
      maxX = Math.max(maxX, Math.abs(v.x));
      z0 = Math.min(z0, v.z);
      z1 = Math.max(z1, v.z);
      n += 1;
    }
  });
  if (n < 12 || maxX < 0.4) return null;
  const len = Math.min(1.15, Math.max(0.4, z1 - z0 - 0.08));
  return { x: maxX, z: (z0 + z1) / 2, len };
}

function swanNeck(rise: number, sweep: number, radius: number): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, sweep),
    new THREE.Vector3(0, rise * 0.32, sweep * 0.25),
    new THREE.Vector3(0, rise * 0.72, -sweep * 0.15),
    new THREE.Vector3(0, rise, -sweep * 0.42),
  ]);
  const geo = new THREE.TubeGeometry(curve, 12, radius, 8, false);
  geo.computeVertexNormals();
  return geo;
}
