import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCarGeometry, wheelLayout } from "./car-model.ts";

function extent(id: string): { length: number; height: number; width: number; tris: number } {
  const built = buildCarGeometry(id);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let tris = 0;
  for (const geometry of Object.values(built.parts)) {
    if (!geometry) continue;
    const position = geometry.getAttribute("position");
    if (!position) continue;
    tris += (geometry.getIndex()?.count ?? position.count) / 3;
    for (let i = 0; i < position.count; i++) {
      minX = Math.min(minX, position.getX(i));
      maxX = Math.max(maxX, position.getX(i));
      minY = Math.min(minY, position.getY(i));
      maxY = Math.max(maxY, position.getY(i));
      minZ = Math.min(minZ, position.getZ(i));
      maxZ = Math.max(maxZ, position.getZ(i));
    }
  }
  for (const geometry of Object.values(built.parts)) geometry?.dispose();
  for (const wheel of built.wheels) {
    wheel.tire.dispose();
    wheel.rim.dispose();
    wheel.disc.dispose();
    wheel.caliper.dispose();
  }
  return { length: maxZ - minZ, height: maxY - minY, width: maxX - minX, tris };
}

describe("car silhouettes", () => {
  it("keeps the contact layout while each body is its own architecture", () => {
    const vector = wheelLayout("vector");
    const surge = wheelLayout("surge");
    const vanta = wheelLayout("vanta");
    const aegis = wheelLayout("aegis");
    assert.equal(vector.wheelbase, 2.5);
    assert.ok(Math.abs(surge.wheelbase - 2.82) < 1e-9);
    assert.ok(Math.abs(vanta.wheelbase - 2.38) < 1e-9);
    assert.ok(Math.abs(aegis.halfWidth * 2 - 2.36) < 1e-9);

    const mesh = {
      vector: extent("vector"),
      vanta: extent("vanta"),
      surge: extent("surge"),
      aegis: extent("aegis"),
    };
    assert.ok(mesh.surge.length > mesh.vector.length, "the LMP is longer than the GT3");
    assert.ok(mesh.surge.height < 1.05, `the LMP stays low, height ${mesh.surge.height}`);
    assert.ok(mesh.vanta.length < mesh.vector.length - 0.6, "the GT4 is the short car");
    assert.ok(mesh.vanta.height > mesh.vector.height, "the GT4 cabin is taller than the GT3");
    assert.ok(mesh.aegis.width > mesh.vector.width, "the TCR is the wide car");
    assert.ok(mesh.aegis.height > 1.1, "the TCR greenhouse stands up");
    const heights = new Set([mesh.vector.height, mesh.vanta.height, mesh.surge.height, mesh.aegis.height].map((n) => n.toFixed(2)));
    assert.ok(heights.size >= 3, "the four roofs are not one shared height");
  });
});
