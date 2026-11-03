import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { averageNormal, faceToward, firstTriangleNormal, triangleNormal } from "./road-winding.ts";
import { mulberry32, roadTextureSeed, withRoadSeed } from "./road-surface.ts";

function strip(y: number, flip: boolean): THREE.BufferGeometry {
  const positions = new Float32Array([
    -1, y, 0,
    1, y, 0,
    -1, y, 2,
    1, y, 2,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  // left0, left1, right0 — the ribbon order. Faces up. The flip path reverses it.
  // Both triangles of the flipped strip face down. Mixing one up and one down
  // cancels the average and hides the bug the helper is there to catch.
  const indices = flip ? [0, 1, 2, 1, 3, 2] : [0, 2, 1, 1, 2, 3];
  geo.setIndex(indices);
  return geo;
}

describe("road winding", () => {
  it("a left-to-right forward strip faces up", () => {
    const n = triangleNormal(-1, 0, 0, -1, 0, 2, 1, 0, 0);
    assert.ok(n[1] > 0.9, `expected +Y, got ${n}`);
  });

  it("faceToward corrects a downward deck so FrontSide still shows the asphalt", () => {
    const geo = strip(0.03, true);
    const before = averageNormal(geo);
    assert.ok(before.y < 0);
    const flipped = faceToward(geo, new THREE.Vector3(0, 1, 0));
    assert.equal(flipped, true);
    const after = averageNormal(geo);
    assert.ok(after.y > 0.9);
    geo.dispose();
  });

  it("a vertical wall can be turned to face the road", () => {
    // Wall in the YZ plane at x = 4. Triangles wound to face -X, we want +X.
    const positions = new Float32Array([
      4, 0, 0,
      4, 1, 0,
      4, 0, 2,
      4, 1, 2,
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setIndex([0, 2, 1, 1, 2, 3]);
    faceToward(geo, new THREE.Vector3(1, 0, 0));
    const n = averageNormal(geo);
    assert.ok(n.x > 0.9, `wall should face +X, got ${n.x}`);
    geo.dispose();
  });

  it("orients every face of a closed barrier when the loop-wide normal cancels", () => {
    const count = 32;
    const positions: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const x = Math.cos(angle) * 4;
      const z = Math.sin(angle) * 4;
      positions.push(x, 0, z, x, 1, z);
    }
    for (let i = 0; i < count; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = ((i + 1) % count) * 2;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    assert.ok(averageNormal(geo).length() < 1e-5, "a complete loop should have a cancelling average normal");
    assert.ok(firstTriangleNormal(geo).length() > 0.99);
    assert.equal(faceToward(geo, new THREE.Vector3(1, 0, 0)), true);
    const position = geo.getAttribute("position");
    const index = geo.getIndex()!;
    for (let i = 0; i < index.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(position, index.getX(i));
      const b = new THREE.Vector3().fromBufferAttribute(position, index.getX(i + 1));
      const c = new THREE.Vector3().fromBufferAttribute(position, index.getX(i + 2));
      const [nx, ny, nz] = triangleNormal(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      const radial = new THREE.Vector3(a.x + b.x + c.x, 0, a.z + b.z + c.z).normalize();
      assert.ok(new THREE.Vector3(nx, ny, nz).dot(radial) > 0.98, `face points inward: ${nx}, ${ny}, ${nz}`);
    }
    geo.dispose();
  });
});

describe("asphalt seed", () => {
  it("is stable for a theme and different across themes", () => {
    const a = roadTextureSeed("city", 11);
    const b = roadTextureSeed("city", 11);
    const c = roadTextureSeed("yard", 11);
    assert.equal(a, b);
    assert.notEqual(a, c);
    const rng = mulberry32(a);
    const first = [rng(), rng(), rng()];
    const again = mulberry32(a);
    assert.deepEqual(first, [again(), again(), again()]);
  });

  it("seeds texture noise repeatably and restores the outer seed after nested or failed builds", () => {
    const seed = roadTextureSeed("coast", 29);
    const sample = (value: number) => withRoadSeed(value, (random) => [random(), random(), random()]);
    const first = sample(seed);
    const second = sample(seed);
    assert.deepEqual(first, second);
    assert.notDeepEqual(first, sample(seed + 1));

    const expected = mulberry32(seed);
    const nested = withRoadSeed(seed, (random) => {
      const before = random();
      assert.throws(() => withRoadSeed(seed + 1, () => { throw new Error("sentinel"); }), /sentinel/);
      const afterThrow = random();
      withRoadSeed(seed + 2, (inner) => inner());
      const afterNested = random();
      return [before, afterThrow, afterNested];
    });
    assert.deepEqual(nested, [expected(), expected(), expected()]);
  });
});
