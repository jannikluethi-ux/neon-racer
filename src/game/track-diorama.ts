import * as THREE from "three";
import { buildCourse } from "./track";
import { themeFor, type TrackTheme } from "./track-def";

/**
 * A small physical model of one existing circuit.
 * The ribbon follows the race centreline and its elevation. Width is exaggerated
 * so the shape reads on a tabletop; collision and the race mesh are untouched.
 */
export type TrackDiorama = {
  group: THREE.Group;
  dispose: () => void;
};

const SPAN = 9.2;

function ribbon(
  samples: ReturnType<typeof buildCourse>["samples"],
  scale: number,
  ox: number,
  oy: number,
  oz: number,
  half: number,
): THREE.BufferGeometry {
  const n = samples.length;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = samples[i]!;
    const x = (s.x - ox) * scale;
    const y = (s.y - oy) * scale;
    const z = (s.z - oz) * scale;
    positions.push(x - s.rx * half, y, z - s.rz * half, x + s.rx * half, y, z + s.rz * half);
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = ((i + 1) % n) * 2;
    const d = c + 1;
    indices.push(a, c, d, a, d, b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function hash(n: number): number {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

export function buildTrackDiorama(id: string): TrackDiorama {
  const course = buildCourse(id);
  const theme: TrackTheme = themeFor(course.themeId);
  const samples = course.samples;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minY = Infinity;
  for (const s of samples) {
    minX = Math.min(minX, s.x);
    maxX = Math.max(maxX, s.x);
    minZ = Math.min(minZ, s.z);
    maxZ = Math.max(maxZ, s.z);
    minY = Math.min(minY, s.y);
  }
  const span = Math.max(maxX - minX, maxZ - minZ, 1);
  const scale = SPAN / span;
  const ox = (minX + maxX) / 2;
  const oz = (minZ + maxZ) / 2;
  const group = new THREE.Group();
  group.name = `diorama-${id}`;

  const owned: Array<THREE.BufferGeometry | THREE.Material> = [];
  const keep = <T extends THREE.BufferGeometry | THREE.Material>(item: T): T => {
    owned.push(item);
    return item;
  };

  const deck = new THREE.Mesh(
    keep(new THREE.CircleGeometry(SPAN * 0.72, 48)),
    keep(
      new THREE.MeshStandardMaterial({
        color: theme.hemiGround,
        roughness: 0.9,
        metalness: 0.04,
      }),
    ),
  );
  deck.rotation.x = -Math.PI / 2;
  deck.position.y = 0.012;
  deck.receiveShadow = true;
  group.add(deck);

  if (theme.kind === "coast") {
    const water = new THREE.Mesh(
      keep(new THREE.CircleGeometry(SPAN * 0.95, 40)),
      keep(new THREE.MeshStandardMaterial({ color: 0x0d3144, roughness: 0.22, metalness: 0.45 })),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.004;
    group.add(water);
  }

  const asphalt = new THREE.Mesh(
    keep(ribbon(samples, scale, ox, minY, oz, 0.28)),
    keep(new THREE.MeshStandardMaterial({ color: 0xc5ced6, roughness: 0.42, metalness: 0.18, emissive: 0x2a3440, emissiveIntensity: 0.45 })),
  );
  asphalt.position.y = 0.12;
  asphalt.material.side = THREE.DoubleSide;
  asphalt.castShadow = true;
  asphalt.receiveShadow = true;
  group.add(asphalt);

  const edge = new THREE.Mesh(
    keep(ribbon(samples, scale, ox, minY, oz, 0.4)),
    keep(
      new THREE.MeshStandardMaterial({
        color: theme.edgeL,
        emissive: theme.edgeL,
        emissiveIntensity: 0.85,
        roughness: 0.35,
        metalness: 0.15,
      }),
    ),
  );
  edge.position.y = 0.08;
  edge.material.side = THREE.DoubleSide;
  group.add(edge);

  const stride = Math.max(1, Math.floor(samples.length / 220));
  const linePoints: THREE.Vector3[] = [];
  for (let i = 0; i < samples.length; i += stride) {
    const s = samples[i]!;
    linePoints.push(new THREE.Vector3((s.x - ox) * scale, (s.y - minY) * scale + 0.22, (s.z - oz) * scale));
  }
  const line = new THREE.LineLoop(
    keep(new THREE.BufferGeometry().setFromPoints(linePoints)),
    keep(new THREE.LineBasicMaterial({ color: theme.edgeL })),
  );
  group.add(line);

  const start = samples[0];
  if (start) {
    const mark = new THREE.Mesh(
      keep(new THREE.BoxGeometry(0.9, 0.04, 0.12)),
      keep(new THREE.MeshStandardMaterial({ color: 0xf4f7fb, roughness: 0.4 })),
    );
    mark.position.set((start.x - ox) * scale, (start.y - minY) * scale + 0.1, (start.z - oz) * scale);
    mark.lookAt(mark.position.x + start.tx, mark.position.y, mark.position.z + start.tz);
    group.add(mark);
  }

  const block = keep(new THREE.BoxGeometry(1, 1, 1));
  const bodyMat = keep(new THREE.MeshStandardMaterial({ color: 0x141a22, roughness: 0.78, metalness: 0.08 }));
  const accentMat = keep(
    new THREE.MeshStandardMaterial({
      color: 0x0c0e12,
      emissive: theme.edgeR,
      emissiveIntensity: 0.7,
      roughness: 0.35,
    }),
  );
  const tall = theme.kind === "city" ? 2.2 : theme.kind === "coast" ? 0.7 : 1.4;
  for (let i = 0; i < 10; i++) {
    const ang = Math.PI + (i / 9) * Math.PI + hash(theme.citySeed + i) * 0.08;
    const rad = SPAN * (0.72 + hash(theme.citySeed * 3 + i) * 0.08);
    const h = tall * (0.4 + hash(i + 4) * 0.6);
    const w = 0.45 + hash(i + 9) * 0.55;
    const tower = new THREE.Mesh(block, bodyMat);
    tower.scale.set(w, h, w);
    tower.position.set(Math.cos(ang) * rad, h / 2, Math.sin(ang) * rad);
    tower.castShadow = true;
    group.add(tower);
    if (i % 3 === 0) {
      const strip = new THREE.Mesh(block, accentMat);
      strip.scale.set(w * 1.02, 0.06, w * 1.02);
      strip.position.set(tower.position.x, h * 0.72, tower.position.z);
      group.add(strip);
    }
  }

  return {
    group,
    dispose: () => {
      group.removeFromParent();
      for (const item of owned) item.dispose();
    },
  };
}
