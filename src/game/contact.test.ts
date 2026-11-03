import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { buildCarGeometry, wheelLayout } from "./car-model.ts";
import { DECAL_CLEARANCE, fitRoadGrade, planeHeight } from "./contact.ts";
import { applyContact } from "./vehicle.ts";
import { buildCourse } from "./track.ts";
import { syncWheelContactDecal } from "./visuals.ts";
import type { CarState } from "./types.ts";

describe("road grade fit", () => {
  const layout = { frontX: 0.85, rearX: 0.9, frontZ: 1.15, rearZ: -1.35 };

  it("pitches nose-up on an uphill and stays level laterally", () => {
    const wb = layout.frontZ - layout.rearZ;
    const rise = 0.08;
    const front = 1 + rise;
    const rear = 1;
    const fit = fitRoadGrade([front, front, rear, rear], layout);
    assert.ok(fit.pitch > 0.02, `expected nose-up, got ${fit.pitch}`);
    assert.ok(Math.abs(fit.roll) < 1e-6);
    assert.ok(Math.abs(fit.sinPitch - rise / wb) < 1e-9);
    assert.ok(Math.abs(planeHeight(fit, layout.frontX, layout.frontZ) - front) < 1e-6);
    assert.ok(Math.abs(planeHeight(fit, -layout.rearX, layout.rearZ) - rear) < 1e-6);
  });

  it("rolls left-up when only the left tires are on a kerb", () => {
    const fit = fitRoadGrade([0.08, 0, 0.08, 0], layout);
    assert.ok(fit.roll > 0.02);
    assert.ok(Math.abs(fit.pitch) < 1e-6);
    const left = planeHeight(fit, layout.frontX, layout.frontZ);
    const right = planeHeight(fit, -layout.frontX, layout.frontZ);
    assert.ok(left > right);
  });

  it("leaves a residual when one wheel is raised and the other three are flat", () => {
    const heights = [0.1, 0, 0, 0] as [number, number, number, number];
    const fit = fitRoadGrade(heights, layout);
    const predicted = planeHeight(fit, layout.frontX, layout.frontZ);
    const residual = heights[0] - predicted;
    assert.ok(Math.abs(residual) < 0.04, "the plane should absorb most of a single-wheel step");
    assert.ok(Math.abs(residual) > 0, "one wheel cannot lie on a plane fitted to four unequal points without a leftover");
  });

  it("fits uphill, downhill, and cross-slope contact for every authored wheel layout", () => {
    for (const id of ["vector", "vanta", "surge", "aegis"] as const) {
      const wheels = wheelLayout(id);
      const up = fitRoadGrade([1.12, 1.12, 1, 1], wheels);
      const down = fitRoadGrade([1, 1, 1.12, 1.12], wheels);
      const left = fitRoadGrade([1.1, 1, 1.1, 1], wheels);
      assert.ok(up.pitch > 0, `${id} should pitch up on an uphill`);
      assert.ok(down.pitch < 0, `${id} should pitch down on a downhill`);
      assert.ok(left.roll > 0, `${id} should roll left-up when its left wheels rise`);
      assert.ok(Number.isFinite(up.center + down.center + left.center));
    }
  });
});

describe("contact decals", () => {
  it("places and tilts each mark from its own wheel's world position", () => {
    const root = new THREE.Group();
    root.position.set(7, 2, -4);
    root.rotation.set(-0.12, 0.4, 0.06);
    const decals: THREE.Object3D[] = [];
    const normals: [number, number, number][] = [
      [0.08, 0.994, -0.06],
      [-0.04, 0.998, 0.03],
      [0.1, 0.993, 0.05],
      [-0.09, 0.991, -0.07],
    ];
    const radii = [0.345, 0.345, 0.34, 0.35];
    for (let i = 0; i < 4; i++) {
      const wheel = new THREE.Group();
      wheel.position.set(i % 2 === 0 ? 0.9 : -0.9, 0.36 + i * 0.018, i < 2 ? 1.2 : -1.3);
      const decal = new THREE.Object3D();
      root.add(wheel, decal);
      decals.push(decal);
    }
    root.updateMatrixWorld(true);
    const expectedWorld: THREE.Vector3[] = [];
    for (let i = 0; i < 4; i++) {
      const wheel = root.children[i * 2]!;
      const decal = decals[i]!;
      const center = wheel.getWorldPosition(new THREE.Vector3());
      const normal = new THREE.Vector3(...normals[i]!).normalize();
      expectedWorld.push(center.clone().addScaledVector(normal, -radii[i]! + DECAL_CLEARANCE));
      syncWheelContactDecal(root, wheel, decal, radii[i]!, normals[i]!);
    }
    root.updateMatrixWorld(true);
    for (let i = 0; i < decals.length; i++) {
      const decal = decals[i]!;
      const point = decal.getWorldPosition(new THREE.Vector3());
      assert.ok(point.distanceTo(expectedWorld[i]!) < 1e-6, `wheel ${i} decal did not follow its own contact point`);
      const actualNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(decal.getWorldQuaternion(new THREE.Quaternion()));
      const expectedNormal = new THREE.Vector3(...normals[i]!).normalize();
      assert.ok(actualNormal.dot(expectedNormal) > 0.999, `wheel ${i} decal did not align with its road plane`);
    }
  });
});

describe("vehicle wheel tracks", () => {
  it("uses a different half-track per car, none of them the old 1.0 m constant", () => {
    const ids = ["vector", "vanta", "surge", "aegis"] as const;
    const tracks = ids.map((id) => wheelLayout(id));
    const expected = [
      { frontX: 0.85, rearX: 0.89, wheelbase: 2.5, width: 2.14 },
      { frontX: 0.885, rearX: 0.935, wheelbase: 2.38, width: 2.24 },
      { frontX: 0.88, rearX: 0.91, wheelbase: 2.82, width: 2.2 },
      { frontX: 0.95, rearX: 1, wheelbase: 2.52, width: 2.36 },
    ];
    for (const layout of tracks) {
      assert.ok(layout.frontX > 0.7 && layout.frontX < 1.05, `${layout.frontX}`);
      assert.ok(layout.rearX > 0.7 && layout.rearX < 1.05);
      assert.notEqual(layout.frontX, 1);
      assert.ok(Math.abs(layout.wheelbase - (layout.frontZ - layout.rearZ)) < 1e-9);
    }
    for (let i = 0; i < ids.length; i++) {
      const layout = tracks[i]!;
      const target = expected[i]!;
      assert.ok(Math.abs(layout.frontX - target.frontX) < 1e-9);
      assert.ok(Math.abs(layout.rearX - target.rearX) < 1e-9);
      assert.ok(Math.abs(layout.wheelbase - target.wheelbase) < 1e-9);
      assert.ok(Math.abs(layout.halfWidth * 2 - target.width) < 1e-9);
      const built = buildCarGeometry(ids[i]!);
      assert.deepEqual(
        built.wheels.map(({ x, z, radius }) => [x, z, radius]),
        [
          [layout.frontX, layout.frontZ, layout.frontRadius],
          [-layout.frontX, layout.frontZ, layout.frontRadius],
          [layout.rearX, layout.rearZ, layout.rearRadius],
          [-layout.rearX, layout.rearZ, layout.rearRadius],
        ],
        `${ids[i]} renderer wheel positions must match the simulator layout`,
      );
      const owned = new Set([
        ...Object.values(built.parts),
        ...built.wheels.flatMap((wheel) => [wheel.tire, wheel.rim, wheel.disc, wheel.caliper]),
      ]);
      for (const geometry of owned) geometry.dispose();
    }
    const fronts = new Set(tracks.map((t) => t.frontX.toFixed(4)));
    assert.ok(fronts.size >= 3, "the four cars must not share one track width");
    const vector = tracks[0]!;
    const aegis = tracks[3]!;
    assert.ok(aegis.frontX > vector.frontX, "AEGIS is the wide car");
    assert.equal(vector.wheelbase, 2.5);
    assert.ok(Math.abs(tracks[2]!.wheelbase - 2.82) < 1e-9);
    assert.ok(Math.abs(aegis.halfWidth * 2 - 2.36) < 1e-9);
  });
});

describe("applyContact on a real climb", () => {
  it("pitches all four cars nose-up on Nightfall's steepest uphill without touching speed", () => {
    const track = buildCourse("nightfall");
    let bestI = 0;
    let best = -Infinity;
    for (let i = 0; i < track.samples.length; i++) {
      const s = track.samples[i]!;
      const n = track.samples[(i + 8) % track.samples.length]!;
      const grade = (n.y - s.y) / Math.max(1, n.dist - s.dist);
      if (grade > best) {
        best = grade;
        bestI = i;
      }
    }
    const s = track.samples[bestI]!;
    for (const vehicleId of ["vector", "vanta", "surge", "aegis"] as const) {
      const car = {
        x: s.x,
        z: s.z,
        yaw: Math.atan2(-s.tx, -s.tz),
        hint: bestI,
        vehicleId,
        gradePitch: 0,
        gradeRoll: 0,
        wheelKerb: [0, 0, 0, 0],
        wheelNormals: [[0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0]],
        kerbL: 0,
        kerbR: 0,
        forwardSpeed: 40,
        vx: 1,
        vz: 1,
      } as CarState;
      const y = applyContact(car, track);
      assert.ok(car.gradePitch > 0, `${vehicleId} expected uphill pitch, got ${car.gradePitch} (chord grade ${best})`);
      assert.equal(car.forwardSpeed, 40);
      assert.equal(car.vx, 1);
      assert.equal(car.vz, 1);
      assert.ok(Number.isFinite(y));
      assert.equal(car.wheelKerb.length, 4);
      assert.equal(car.wheelNormals.length, 4);
      for (const normal of car.wheelNormals) assert.ok(Math.abs(Math.hypot(...normal) - 1) < 1e-6);
    }
  });
});
