import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { ROAD_DECK_Y } from "./contact";
import { VEHICLES } from "./vehicle-def";
import { createCarView, type CarView } from "./visuals";

/**
 * Dev-only orthographic lineup. Not part of the garage camera and not shown
 * unless `?compare=1` is set in a dev build.
 */

const GAP = 6.6;

const BOUNDS: Record<string, { z0: number; z1: number; halfW: number; h: number }> = {
  vector: { z0: -2.4, z1: 2.28, halfW: 1.16, h: 1.22 },
  vanta: { z0: -1.78, z1: 1.66, halfW: 1.2, h: 1.12 },
  surge: { z0: -2.62, z1: 2.55, halfW: 1.2, h: 1.02 },
  aegis: { z0: -2.02, z1: 2.0, halfW: 1.26, h: 1.4 },
};

type ShotKind = "side" | "front34" | "rear34" | "front" | "side1" | "rear" | "wing";

function parseShot(shot: string): { kind: ShotKind; car: string | null } {
  if (shot === "side" || shot === "front34" || shot === "rear34") return { kind: shot, car: null };
  const [car, view] = shot.split("-");
  if (!car || !BOUNDS[car]) return { kind: "side", car: null };
  if (view === "front34") return { kind: "front34", car };
  if (view === "wing") return { kind: "wing", car };
  if (view === "front" || view === "side" || view === "rear") {
    return { kind: view === "side" ? "side1" : view, car };
  }
  return { kind: "side", car: null };
}

export type CompareHandle = {
  render: () => void;
  dispose: () => void;
};

export function createCompareScene(renderer: THREE.WebGLRenderer): CompareHandle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xc3cbd3);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = env.texture;
  scene.environmentIntensity = 0.85;
  pmrem.dispose();

  const hemi = new THREE.HemisphereLight(0xf7f9fb, 0x747c86, 0.9);
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(7, 11, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 48;
  key.shadow.camera.left = -18;
  key.shadow.camera.right = 18;
  key.shadow.camera.top = 18;
  key.shadow.camera.bottom = -18;
  key.shadow.bias = -0.00035;
  const fill = new THREE.DirectionalLight(0xd7e0ea, 0.75);
  fill.position.set(-8, 5, -3);
  scene.add(hemi, key, key.target, fill);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(48, 64),
    new THREE.MeshStandardMaterial({ color: 0xaeb6be, roughness: 0.92, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = ROAD_DECK_Y;
  ground.receiveShadow = true;
  scene.add(ground);

  const views: Array<{ id: string; view: CarView }> = VEHICLES.map((def) => {
    const view = createCarView(def.color, def.id, false);
    view.paint.envMapIntensity = 0.85;
    view.paint.clearcoatRoughness = 0.08;
    view.headLight.visible = false;
    view.headLight.intensity = 0;
    view.tailLight.intensity = 0;
    scene.add(view.root);
    return { id: def.id, view };
  });

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 90);
  const eye = new THREE.Vector3();
  const target = new THREE.Vector3();
  const scratch = new THREE.Vector3();

  const place = (kind: ShotKind, only: string | null) => {
    const lineup = !only && (kind === "side" || kind === "front34" || kind === "rear34");
    views.forEach((entry, index) => {
      const show = lineup || entry.id === only;
      entry.view.root.visible = show;
      if (!show) return;
      if (kind === "side") {
        entry.view.root.position.set(0, 0, (1.5 - index) * GAP);
      } else if (lineup) {
        entry.view.root.position.set((index - 1.5) * GAP, 0, 0);
      } else {
        entry.view.root.position.set(0, 0, 0);
      }
      entry.view.root.rotation.set(0, 0, 0);
    });
  };

  const cornersOf = (entry: { id: string; view: CarView }): THREE.Vector3[] => {
    const box = BOUNDS[entry.id]!;
    entry.view.root.updateWorldMatrix(true, true);
    const pts: THREE.Vector3[] = [];
    for (const x of [-box.halfW, box.halfW]) {
      for (const y of [-0.02, box.h]) {
        for (const z of [box.z0, box.z1]) {
          pts.push(scratch.set(x, y, z).applyMatrix4(entry.view.root.matrixWorld).clone());
        }
      }
    }
    return pts;
  };

  const frame = (aspect: number, points: THREE.Vector3[]) => {
    camera.position.copy(eye);
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const point of points) {
      scratch.copy(point).applyMatrix4(camera.matrixWorldInverse);
      minX = Math.min(minX, scratch.x);
      maxX = Math.max(maxX, scratch.x);
      minY = Math.min(minY, scratch.y);
      maxY = Math.max(maxY, scratch.y);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    let halfW = Math.max(0.5, (maxX - minX) / 2) * 1.14;
    let halfH = Math.max(0.35, (maxY - minY) / 2) * 1.2;
    if (halfW / halfH > aspect) halfH = halfW / aspect;
    else halfW = halfH * aspect;
    camera.left = cx - halfW;
    camera.right = cx + halfW;
    camera.top = cy + halfH;
    camera.bottom = cy - halfH;
    camera.updateProjectionMatrix();
  };

  const render = () => {
    const shot = new URLSearchParams(window.location.search).get("shot") || "side";
    const parsed = parseShot(shot);
    place(parsed.kind, parsed.car);
    if (parsed.kind === "side" || parsed.kind === "side1" || parsed.kind === "wing") eye.set(16, 0.85, 0);
    else if (parsed.kind === "front") eye.set(0, 0.85, 12);
    else if (parsed.kind === "rear") eye.set(0, 0.85, -12);
    else if (parsed.kind === "front34") eye.set(12, 2.6, 13);
    else eye.set(12, 2.6, -13);
    target.set(0, parsed.kind === "wing" ? 0.85 : 0.58, parsed.kind === "wing" ? -1.4 : 0);
    const visible = views.filter((entry) => entry.view.root.visible);
    const points =
      parsed.kind === "wing"
        ? visible.flatMap((entry) => {
            const box = BOUNDS[entry.id]!;
            entry.view.root.updateWorldMatrix(true, true);
            const pts: THREE.Vector3[] = [];
            for (const x of [-0.2, box.halfW]) {
              for (const y of [0.45, box.h]) {
                for (const z of [box.z0, box.z0 + 1.1]) {
                  pts.push(scratch.set(x, y, z).applyMatrix4(entry.view.root.matrixWorld).clone());
                }
              }
            }
            return pts;
          })
        : visible.flatMap(cornersOf);
    const width = renderer.domElement.width || 1;
    const height = renderer.domElement.height || 1;
    frame(width / height, points);
    renderer.render(scene, camera);
  };

  return {
    render,
    dispose: () => {
      env.texture.dispose();
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      for (const entry of views) entry.view.root.removeFromParent();
    },
  };
}
