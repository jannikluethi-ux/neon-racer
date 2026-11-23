import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type * as THREE from "three";
import type { Track } from "./track.ts";
import type { TrackTheme } from "./track-def.ts";

// Canvas-backed textures are only touched while a scene is built, so a tiny
// DOM stub keeps the real scene construction runnable in Node without a canvas.
function stubContext(): unknown {
  const gradient = { addColorStop: () => {} };
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "canvas") return stubCanvas();
        if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => gradient;
        if (prop === "createPattern") return () => null;
        if (prop === "createImageData" || prop === "getImageData") {
          return (...args: number[]) => {
            const w = args.length > 2 ? args[2]! : args[0]!;
            const h = args.length > 2 ? args[3]! : args[1]!;
            return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
          };
        }
        if (prop === "measureText") return () => ({ width: 0 });
        return () => undefined;
      },
      set: () => true,
    },
  );
}

function stubCanvas(): { width: number; height: number; getContext: () => unknown } {
  return { width: 0, height: 0, getContext: () => stubContext() };
}

(globalThis as { document?: unknown }).document = { createElement: () => stubCanvas() };

const THREE_NS = await import("three");
const { buildCourse } = await import("./track.ts");
const { TRACKS, themeFor } = await import("./track-def.ts");
const { addScenery } = await import("./scenery.ts");
const { applySceneryQuality, buildScene } = await import("./visuals.ts");

type Scenery = {
  track: Track;
  theme: TrackTheme;
  structure: THREE.Group;
  dressing: THREE.Group;
};

/** Builds the real scenery for one circuit, split into its two layers. */
function sceneryFor(trackId: string): Scenery {
  const track = buildCourse(trackId);
  const theme = themeFor(track.themeId);
  const structure = new THREE_NS.Group();
  const dressing = new THREE_NS.Group();
  addScenery(structure, dressing, track, theme);
  return { track, theme, structure, dressing };
}

function instancePositions(group: THREE.Object3D): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const matrix = new THREE_NS.Matrix4();
  group.traverse((obj) => {
    const mesh = obj as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh) return;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      out.push(new THREE_NS.Vector3().setFromMatrixPosition(matrix));
    }
  });
  return out;
}

/** True when the layer holds geometry above the track's covered (tunnel) run. */
function coversTunnelRun(track: Track, theme: TrackTheme, group: THREE.Object3D): boolean {
  const limit = theme.tunnelBelow;
  if (limit == null) return false;
  return instancePositions(group).some((p) =>
    track.samples.some((s) => s.y <= limit && p.y > s.y + 2 && Math.hypot(p.x - s.x, p.z - s.z) < s.width),
  );
}

/** True when the layer holds supports underneath an elevated racing surface. */
function supportsElevatedDeck(track: Track, group: THREE.Object3D): boolean {
  return instancePositions(group).some((p) =>
    track.samples.some(
      (s) => s.y - track.minY > 3.2 && p.y < s.y - 1 && Math.hypot(p.x - s.x, p.z - s.z) < s.width + 8,
    ),
  );
}

describe("essential environment is preserved at Low quality (NR-016)", () => {
  it("keeps the NIGHTFALL tunnel in the essential layer", () => {
    const { track, theme, structure, dressing } = sceneryFor("nightfall");
    applySceneryQuality({ structure, dressing }, "low");
    assert.equal(structure.visible, true, "essential structure must never be hidden");
    assert.equal(dressing.visible, false);
    assert.ok(
      coversTunnelRun(track, theme, structure),
      "the tunnel shell must live in the essential layer, not in the dropped dressing",
    );
  });

  it("keeps every track's tunnel in the essential layer", () => {
    for (const def of TRACKS) {
      const { track, theme, structure, dressing } = sceneryFor(def.id);
      if (theme.tunnelBelow == null) continue;
      assert.ok(
        coversTunnelRun(track, theme, structure),
        `${def.name} tunnel missing from the essential layer`,
      );
      applySceneryQuality({ structure, dressing }, "low");
      assert.equal(structure.visible, true);
    }
  });

  it("keeps the supports under elevated racing surfaces in the essential layer", () => {
    for (const id of ["nightfall", "velocity"]) {
      const { track, structure, dressing } = sceneryFor(id);
      applySceneryQuality({ structure, dressing }, "low");
      assert.equal(structure.visible, true);
      assert.ok(supportsElevatedDeck(track, structure), `${id} deck supports missing from the essential layer`);
    }
  });

  it("preserves the essential layer at every quality level on every track", () => {
    for (const def of TRACKS) {
      const { structure, dressing } = sceneryFor(def.id);
      const count = instancePositions(structure).length;
      for (const quality of ["low", "medium", "high"] as const) {
        applySceneryQuality({ structure, dressing }, quality);
        assert.equal(structure.visible, true, `${def.name} structure hidden at ${quality}`);
        assert.equal(instancePositions(structure).length, count, `${def.name} structure lost at ${quality}`);
      }
    }
  });

  it("still drops decorative dressing on Low and restores it above", () => {
    const { structure, dressing } = sceneryFor("nightfall");
    assert.ok(instancePositions(dressing).length > 0, "dressing must carry decor for Low to drop");
    applySceneryQuality({ structure, dressing }, "low");
    assert.equal(dressing.visible, false);
    applySceneryQuality({ structure, dressing }, "medium");
    assert.equal(dressing.visible, true);
    applySceneryQuality({ structure, dressing }, "high");
    assert.equal(dressing.visible, true);
  });

  it("registers scenery ownership on both layers so disposal still finds them", () => {
    const { structure, dressing } = sceneryFor("nightfall");
    for (const layer of [structure, dressing]) {
      const geos = layer.userData.ownedSceneryGeometries as THREE.BufferGeometry[] | undefined;
      const mats = layer.userData.ownedSceneryMaterials as THREE.Material[] | undefined;
      assert.ok((geos?.length ?? 0) > 0, "geometry ownership missing");
      assert.ok((mats?.length ?? 0) > 0, "material ownership missing");
    }
  });

  it("leaves road and barrier geometry untouched by the quality setting", () => {
    const bundle = buildScene(buildCourse("nightfall"), []);
    const roadChildren = bundle.road.group.children.length;
    assert.ok(roadChildren > 0, "road surfaces must exist");
    assert.equal(bundle.road.group.visible, true);
    for (const quality of ["low", "medium", "high"] as const) {
      applySceneryQuality(bundle, quality);
      assert.equal(bundle.road.group.visible, true, `road hidden at ${quality}`);
      assert.equal(bundle.road.group.children.length, roadChildren, `road geometry changed at ${quality}`);
    }
  });
});
