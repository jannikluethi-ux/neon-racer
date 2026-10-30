import { useEffect, useRef } from "react";
import * as THREE from "three";
import { buildCourse } from "@/game/track";
import { themeFor } from "@/game/track-def";
import type { VehicleDefinition } from "@/game/vehicle-def";
import { createCarView, releaseObject } from "@/game/visuals";

function useStage(
  hostRef: { readonly current: HTMLDivElement | null },
  buildRef: { readonly current: (scene: THREE.Scene, camera: THREE.PerspectiveCamera) => () => void },
  version: string,
) {
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(1.25, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 500);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tick = buildRef.current(scene, camera);
    let frame = 0;
    let alive = true;
    const fit = () => {
      const w = Math.max(2, host.clientWidth);
      const h = Math.max(2, host.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(host);
    const loop = () => {
      if (!alive) return;
      frame = requestAnimationFrame(loop);
      if (!reduce) tick();
      renderer.render(scene, camera);
    };
    loop();
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      ro.disconnect();
      releaseObject(scene);
      renderer.dispose();
      if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement);
    };
  }, [hostRef, buildRef, version]);
}

export function CarStage({ def }: { def: VehicleDefinition }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const build = useRef<(scene: THREE.Scene, camera: THREE.PerspectiveCamera) => () => void>(() => () => {});
  build.current = (scene, camera) => {
    scene.background = new THREE.Color(0x0c1016);
    scene.add(new THREE.HemisphereLight(0xd5e2ee, 0x12161c, 0.85));
    const key = new THREE.DirectionalLight(0xfff4e4, 2.6);
    key.position.set(3.4, 5.2, 2.6);
    const fill = new THREE.DirectionalLight(0x8eb8de, 0.35);
    fill.position.set(-3.2, 1.6, 1.4);
    const rim = new THREE.DirectionalLight(0xf2f7ff, 2.1);
    rim.position.set(-2.4, 3.2, -5.2);
    scene.add(key, fill, rim);
    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 9),
      new THREE.MeshBasicMaterial({ color: 0x141b26 }),
    );
    backdrop.position.set(0, 2.8, -5.5);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(7, 48),
      new THREE.MeshStandardMaterial({ color: 0x10161e, roughness: 0.22, metalness: 0.78 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.01;
    scene.add(backdrop, floor);
    const view = createCarView(def.color, def.body, false);
    view.headLight.intensity = 0.28;
    scene.add(view.root);
    camera.position.set(2.45, 0.86, 3.25);
    camera.lookAt(0, 0.42, 0.05);
    return () => {
      view.root.rotation.y += 0.005;
    };
  };
  useStage(hostRef, build, def.id);
  return <div className="stage" ref={hostRef} />;
}

function ribbon(samples: { x: number; y: number; z: number; rx: number; rz: number; width: number }[], inset: number, lift: number) {
  const n = samples.length;
  const pos: number[] = [];
  for (const s of samples) {
    const h = Math.max(2, s.width * 0.5 - inset);
    pos.push(s.x - s.rx * h, s.y + lift, s.z - s.rz * h, s.x + s.rx * h, s.y + lift, s.z + s.rz * h);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = ((i + 1) % n) * 2;
    const d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export function TrackStage({ id }: { id: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const build = useRef<(scene: THREE.Scene, camera: THREE.PerspectiveCamera) => () => void>(() => () => {});
  build.current = (scene, camera) => {
    const track = buildCourse(id);
    const theme = themeFor(track.themeId);
    const kind = theme.kind;
    scene.background = new THREE.Color(theme.sky);
    scene.fog = new THREE.FogExp2(theme.fog, 0.0032);
    scene.add(new THREE.HemisphereLight(theme.hemiSky, theme.hemiGround, 1.5));
    const moon = new THREE.DirectionalLight(theme.moon, 1.5);
    moon.position.set(80, 120, 40);
    scene.add(moon);
    const step = Math.max(1, Math.floor(track.samples.length / 160));
    const samples = track.samples.filter((_, i) => i % step === 0);
    const road = new THREE.Mesh(
      ribbon(samples, 0, 0.08),
      new THREE.MeshStandardMaterial({ color: kind === "yard" ? 0x3a3834 : 0x2c3238, roughness: 0.92, metalness: 0.04 }),
    );
    const edge = new THREE.Mesh(
      ribbon(samples, -0.35, 0.1),
      new THREE.MeshStandardMaterial({ color: theme.edgeL, roughness: 0.7, metalness: 0.08, emissive: theme.edgeL, emissiveIntensity: 0.04 }),
    );
    scene.add(road, edge);
    if (kind === "coast") {
      const water = new THREE.Mesh(
        new THREE.PlaneGeometry(5000, 5000),
        new THREE.MeshStandardMaterial({ color: 0x1a7eaa, roughness: 0.34, metalness: 0.22, emissive: 0x083048, emissiveIntensity: 0.35 }),
      );
      water.rotation.x = -Math.PI / 2;
      water.position.y = track.minY - 0.35;
      scene.add(water);
    }
    const accent = kind === "yard" ? 0x6a4a38 : kind === "core" ? 0x4a3038 : kind === "coast" ? 0x1c3a4a : 0x3c4c5c;
    const block = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.84, metalness: 0.08 });
    const count = kind === "coast" ? 6 : kind === "core" ? 8 : 10;
    const boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), block, count + 4);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const s = samples[(i * Math.floor(samples.length / count) + 4) % samples.length]!;
      const side = i % 2 === 0 ? 1 : -1;
      const gap = s.width * 0.5 + (kind === "coast" ? 34 : kind === "city" ? 16 + (i % 3) * 10 : 14);
      const h = kind === "city" ? 16 + (i % 5) * 14 : kind === "yard" ? 7 + (i % 3) * 4 : kind === "core" ? 9 + (i % 4) * 5 : 5;
      const wide = kind === "city" && i % 3 === 0 ? 0.55 : 1;
      dummy.position.set(s.x - s.rx * side * gap, s.y + h * 0.5 * (i % 4 === 0 ? 0.72 : 1), s.z - s.rz * side * gap);
      dummy.scale.set((7 + (i % 3) * 3) * wide, h * (i % 4 === 0 ? 0.62 : 1), 6 + (i % 4) * 2);
      dummy.rotation.set(0, Math.atan2(s.tx, s.tz), 0);
      dummy.updateMatrix();
      boxes.setMatrixAt(i, dummy.matrix);
    }
    const spireAt = samples[Math.floor(samples.length * 0.08)]!;
    dummy.position.set(spireAt.x - spireAt.rx * (spireAt.width * 0.5 + 18), spireAt.y + 28, spireAt.z - spireAt.rz * (spireAt.width * 0.5 + 18));
    dummy.scale.set(3.2, 56, 3.2);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    boxes.setMatrixAt(count, dummy.matrix);
    boxes.count = count + 1;
    boxes.frustumCulled = false;
    scene.add(boxes);
    if (kind === "core" || kind === "yard") {
      let cx = 0;
      let cz = 0;
      for (const s of track.samples) {
        cx += s.x;
        cz += s.z;
      }
      cx /= track.samples.length;
      cz /= track.samples.length;
      const tank = new THREE.Mesh(
        new THREE.CylinderGeometry(kind === "core" ? 14 : 6, kind === "core" ? 18 : 8, kind === "core" ? 32 : 14, 12),
        new THREE.MeshStandardMaterial({ color: kind === "core" ? 0x5a4048 : 0x6a5648, roughness: 0.5, metalness: 0.45 }),
      );
      tank.position.set(cx, track.minY + (kind === "core" ? 16 : 7), cz);
      scene.add(tank);
    }
    if (kind === "coast") {
      const pier = samples[Math.floor(samples.length * 0.12)]!;
      const steel = new THREE.MeshStandardMaterial({ color: 0xd5dee6, roughness: 0.38, metalness: 0.62 });
      const towers: THREE.Object3D[] = [];
      for (const side of [-1, 1]) {
        const tower = new THREE.Mesh(new THREE.BoxGeometry(2.4, 26, 2.2), steel);
        tower.position.set(pier.x + pier.rx * side * (pier.width * 0.5 + 4), pier.y + 10, pier.z + pier.rz * side * (pier.width * 0.5 + 4));
        const foot = new THREE.Mesh(new THREE.BoxGeometry(4.2, 4, 3.4), steel);
        foot.position.set(tower.position.x, pier.y + 1.5, tower.position.z);
        scene.add(tower, foot);
        towers.push(tower);
      }
      const a = towers[0]!.position;
      const b = towers[1]!.position;
      const beam = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.1, a.distanceTo(b)), steel);
      beam.position.copy(a).add(b).multiplyScalar(0.5);
      beam.position.y = pier.y + 22;
      beam.lookAt(b.x, beam.position.y, b.z);
      scene.add(beam);
      const hill = new THREE.Mesh(
        new THREE.ConeGeometry(40, 28, 6),
        new THREE.MeshStandardMaterial({ color: 0x3a5368, roughness: 0.9 }),
      );
      hill.position.set(pier.x + pier.tx * 80, track.minY + 8, pier.z + pier.tz * 80);
      scene.add(hill);
    }
    const low = kind === "city";
    const back = kind === "coast" ? 40 : kind === "core" ? 34 : kind === "yard" ? 26 : 16;
    const up = low ? 3.6 : kind === "coast" ? 9 : 7;
    const side = kind === "coast" ? 14 : low ? 4 : 8;
    const ahead = kind === "coast" ? 70 : kind === "core" ? 18 : 40;
    const anchor = track.samples[Math.floor(track.samples.length * (kind === "core" ? 0.18 : 0.06))]!;
    const look = new THREE.Vector3(anchor.x + anchor.tx * ahead, anchor.y + (low ? 2.2 : 3), anchor.z + anchor.tz * ahead);
    const base = new THREE.Vector3(
      anchor.x - anchor.tx * back + anchor.rx * side,
      anchor.y + up,
      anchor.z - anchor.tz * back + anchor.rz * side,
    );
    camera.fov = kind === "coast" ? 42 : kind === "city" ? 34 : 38;
    camera.updateProjectionMatrix();
    camera.position.copy(base);
    camera.lookAt(look);
    let t = 0;
    return () => {
      t += 0.004;
      camera.position.x = base.x + Math.sin(t) * 1.8;
      camera.position.y = base.y + Math.sin(t * 0.6) * 0.35;
      camera.lookAt(look);
    };
  };
  useStage(hostRef, build, id);
  return <div className="stage" ref={hostRef} />;
}
