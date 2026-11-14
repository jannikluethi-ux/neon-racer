import * as THREE from "three";
import { ROAD_DECK_Y } from "./contact";
import { createCarView, releaseObject, type CarView } from "./visuals";
import { buildEnvironment, type BuiltEnvironment } from "./environment";
import { themeFor, TRACKS } from "./track-def";
import { VEHICLES } from "./vehicle-def";
import { buildTrackDiorama, type TrackDiorama } from "./track-diorama";
import { showcase, wrapIndex } from "./showcase";
import type { MenuScreen } from "./store";

/**
 * Garage and pit used by the menu, car carousel and track carousel.
 * Visual only: it never writes a car pose back into the simulation.
 * Cars are pooled once (four machines) and repositioned, so sliding does not
 * allocate or dispose geometries.
 */

export type Showroom = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  setSize: (width: number, height: number) => void;
  update: (frame: ShowroomFrame) => void;
  dispose: () => void;
};

export type ShowroomFrame = {
  dt: number;
  screen: MenuScreen;
  vehicleId: string;
  quality: "low" | "medium" | "high";
  reduced: boolean;
};

const CAR_GAP = 2.72;
const TRACK_GAP = 8.3;
const VIEW_AZ: Record<typeof showcase.view, number> = {
  front: 0.42,
  side: Math.PI / 2,
  rear: Math.PI,
};

function ease(current: number, target: number, dt: number, rate: number): number {
  const next = current + (target - current) * (1 - Math.exp(-dt * rate));
  return Math.abs(target - next) < 0.0008 ? target : next;
}

function wrapDelta(index: number, focus: number, count: number): number {
  let d = index - focus;
  d -= Math.round(d / count) * count;
  return d;
}

function canvasFloor(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = "#12161c";
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1800; i++) {
      const n = 18 + ((i * 17) % 24);
      g.fillStyle = `rgba(${n},${n + 2},${n + 6},0.45)`;
      g.fillRect((i * 47) % 256, (i * 29) % 256, 2, 2);
    }
    g.strokeStyle = "rgba(46,230,255,0.16)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, 128);
    g.lineTo(256, 128);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 3);
  return tex;
}

export function createShowroom(renderer: THREE.WebGLRenderer): Showroom {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070b10);
  scene.fog = new THREE.FogExp2(0x070b10, 0.028);
  const env: BuiltEnvironment = buildEnvironment(renderer, themeFor("apex"));
  scene.environment = env.texture;
  scene.environmentIntensity = 1.12;

  const camera = new THREE.PerspectiveCamera(36, 1, 0.15, 80);
  const clock = { t: 0 };

  const floorMap = canvasFloor();
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x9aa3ad,
    map: floorMap,
    roughness: 0.28,
    metalness: 0.62,
    envMapIntensity: 1.1,
  });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(36, 0.16, 22), floorMat);
  floor.position.y = ROAD_DECK_Y - 0.08;
  floor.receiveShadow = true;
  scene.add(floor);

  const shell = new THREE.Group();
  scene.add(shell);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x10141b, roughness: 0.72, metalness: 0.18 });
  const back = new THREE.Mesh(new THREE.BoxGeometry(20, 5.2, 0.28), wallMat);
  back.position.set(0, 2.5, -8.2);
  back.receiveShadow = true;
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.28, 4.2, 10), wallMat);
  left.position.set(-9.2, 2.1, -3.2);
  const right = left.clone();
  right.position.x = 9.2;
  shell.add(back, left, right);

  const neonMats: THREE.MeshStandardMaterial[] = [];
  const neon = (x: number, y: number, z: number, w: number, h: number, d: number, color: number) => {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x050608,
      emissive: color,
      emissiveIntensity: 1.4,
      roughness: 0.32,
    });
    neonMats.push(mat);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    bar.position.set(x, y, z);
    shell.add(bar);
  };
  neon(0, 4.15, -8.02, 12, 0.06, 0.05, 0x2ee6ff);
  neon(0, 0.18, -8.02, 8.5, 0.045, 0.04, 0xff3dce);
  neon(-9.04, 2.4, -3.2, 0.05, 0.05, 6.5, 0x2ee6ff);
  neon(9.04, 1.6, -3.2, 0.05, 0.05, 6.5, 0xff3dce);

  const hemi = new THREE.HemisphereLight(0x8eb4cc, 0x0a0c10, 0.42);
  const key = new THREE.DirectionalLight(0xf4f7fb, 2.6);
  key.position.set(5.5, 8.5, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 28;
  key.shadow.camera.left = -8;
  key.shadow.camera.right = 8;
  key.shadow.camera.top = 8;
  key.shadow.camera.bottom = -8;
  key.shadow.bias = -0.0004;
  const rim = new THREE.DirectionalLight(0xff3dce, 0.7);
  rim.position.set(-4.5, 3.2, -5);
  const fill = new THREE.PointLight(0x2ee6ff, 6, 14, 2);
  fill.position.set(0.4, 1.6, 3.4);
  scene.add(hemi, key, key.target, rim, fill);

  const cars = new THREE.Group();
  scene.add(cars);
  const views: CarView[] = VEHICLES.map((def) => {
    const view = createCarView(def.color, def.id, false);
    view.paint.envMapIntensity = 1.05;
    view.paint.clearcoatRoughness = 0.06;
    view.root.position.set(0, 0, 0);
    cars.add(view.root);
    return view;
  });

  const tracks = new THREE.Group();
  scene.add(tracks);
  const dioramas: TrackDiorama[] = TRACKS.map((def) => {
    const model = buildTrackDiorama(def.id);
    tracks.add(model.group);
    return model;
  });

  const setSize = (width: number, height: number) => {
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
  };

  const update = (frame: ShowroomFrame) => {
    const dt = Math.min(0.2, Math.max(0, frame.dt));
    clock.t += dt;
    const lineup = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("lineup") === "1";
    const carsOpen = frame.screen === "cars";
    const tracksOpen = frame.screen === "tracks";
    const venueTarget = tracksOpen ? 1 : 0;
    showcase.venue = frame.reduced ? venueTarget : ease(showcase.venue, venueTarget, dt, 5.5);
    const venue = showcase.venue;

    if (showcase.dragging !== "car") showcase.car = ease(showcase.car, showcase.carTarget, dt, frame.reduced ? 14 : 8);
    if (showcase.dragging !== "track") showcase.track = ease(showcase.track, showcase.trackTarget, dt, frame.reduced ? 14 : 8);

    const selected = Math.max(0, VEHICLES.findIndex((car) => car.id === frame.vehicleId));
    const focusIndex = carsOpen ? wrapIndex(showcase.car, views.length) : selected;
    const spread = carsOpen && showcase.view === "front";
    views.forEach((view, index) => {
      const delta = lineup && carsOpen ? index - (views.length - 1) / 2 : spread ? wrapDelta(index, showcase.car, views.length) : index === focusIndex ? 0 : 4;
      const ad = Math.abs(delta);
      view.root.visible = lineup && carsOpen ? true : spread ? ad < 1.65 : index === focusIndex;
      const scale = lineup && carsOpen ? 0.78 : carsOpen ? 1 - Math.min(1, ad) * 0.38 : 1;
      view.root.scale.setScalar(scale);
      view.root.position.set(carsOpen ? delta * (lineup ? 3.15 : CAR_GAP) : 0, 0, 0);
      view.root.rotation.set(0, lineup && carsOpen ? Math.PI / 2 : carsOpen ? delta * 0.28 : 0, 0);
      view.headLight.visible = frame.quality !== "low" && ad < 0.45;
      view.headLight.intensity = 2.2;
      if (ad < 0.4 && !frame.reduced) {
        for (const wheel of view.wheels) wheel.rotation.x += dt * 0.35;
      }
    });
    cars.position.y = -venue * 2.4;
    cars.visible = venue < 0.38;

    dioramas.forEach((model, index) => {
      const delta = wrapDelta(index, showcase.track, dioramas.length);
      const ad = Math.abs(delta);
      model.group.visible = venue > 0.05 && ad < 1.55;
      const scale = 1 - Math.min(1, ad) * 0.34;
      model.group.scale.setScalar(scale);
      model.group.position.set(delta * TRACK_GAP, 0, 0);
      model.group.rotation.y = delta * -0.18;
    });
    tracks.position.y = (1 - venue) * -1.4;
    tracks.position.z = (1 - venue) * 3.2;

    shell.position.y = -venue * 2.4;
    shell.scale.set(1 + venue * 0.45, 1, 1);
    const pulse = frame.reduced ? 1 : 0.78 + Math.sin(clock.t * 1.7) * 0.22;
    for (const mat of neonMats) mat.emissiveIntensity = (1.15 + (1 - venue) * 0.4) * pulse;
    const fog = scene.fog as THREE.FogExp2;
    fog.density = 0.02 + (1 - venue) * 0.008;
    key.intensity = 2.15 + (1 - venue) * 0.55;
    key.castShadow = frame.quality !== "low";
    rim.color.setHex(venue > 0.55 ? 0xff7a3a : 0xff3dce);
    rim.intensity = 0.45 + venue * 0.35;
    fill.intensity = 4.5 * (1 - venue * 0.65);
    hemi.intensity = 0.34 + venue * 0.18;

    const u = venue * venue * (3 - 2 * venue);
    const zoom = showcase.zoom;
    const az = VIEW_AZ[showcase.view] + (frame.reduced || showcase.dragging ? 0 : Math.sin(clock.t * 0.35) * 0.05);
    const garageDist = (lineup && carsOpen ? 11.5 : carsOpen ? 8.05 : 8.7) * zoom;
    const garageX = Math.sin(az) * garageDist;
    const garageZ = Math.cos(az) * garageDist;
    const garageY = (carsOpen ? 1.72 : 1.78) + showcase.pitch;
    const lookX = carsOpen ? 0 : -1.35;
    const lookY = carsOpen ? -0.15 : 0.48;
    const pitX = 0;
    const pitY = 11.2 * zoom + showcase.pitch;
    const pitZ = 6.4 * zoom;
    camera.position.set(
      garageX + (pitX - garageX) * u,
      garageY + (pitY - garageY) * u,
      garageZ + (pitZ - garageZ) * u,
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(lookX * (1 - u), lookY + (-0.9 - lookY) * u, 0.04 * (1 - u));
    const fov = (carsOpen ? 36 : 36) + 4 * u;
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  };

  const dispose = () => {
    for (const view of views) releaseObject(view.root);
    for (const model of dioramas) model.dispose();
    floor.geometry.dispose();
    floorMat.dispose();
    floorMap.dispose();
    wallMat.dispose();
    back.geometry.dispose();
    left.geometry.dispose();
    for (const mat of neonMats) {
      mat.dispose();
    }
    shell.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry && mesh.geometry !== back.geometry && mesh.geometry !== left.geometry) mesh.geometry.dispose();
    });
    key.shadow.map?.dispose();
    key.shadow.map = null;
    env.dispose();
  };

  return { scene, camera, setSize, update, dispose };
}
