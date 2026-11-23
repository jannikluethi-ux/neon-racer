import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stageFraming } from "./showcase.ts";

const none = { left: 0, right: 0, top: 0, bottom: 0 };

describe("stageFraming", () => {
  it("keeps the default garage framing on a wide screen with no cover", () => {
    for (const [w, h] of [
      [1280, 720],
      [1920, 1080],
      [915, 412],
      [844, 390],
    ] as const) {
      assert.deepEqual(stageFraming(w, h, none), { offsetX: 0, offsetY: 0, fov: 36, distScale: 1 });
    }
  });

  it("centres the cars in the free area right of a side panel", () => {
    const f = stageFraming(915, 412, { left: 348, right: 0, top: 0, bottom: 0 });
    assert.equal(f.offsetX, 174);
    assert.equal(f.offsetY, 0);
    // Free width 567 px is narrower than the 16:9 design, so the camera backs off.
    assert.ok(f.distScale > 1 && f.distScale <= 1.6, `distScale ${f.distScale}`);
    assert.ok(f.fov >= 36 && f.fov <= 52, `fov ${f.fov}`);
  });

  it("shows at least the design width in the free area when the limits allow", () => {
    const w = 844;
    const h = 390;
    const left = 320;
    const f = stageFraming(w, h, { left, right: 0, top: 0, bottom: 0 });
    const halfTan = Math.tan(((f.fov / 2) * Math.PI) / 180) * f.distScale;
    const freeAspectShown = (halfTan * (w - left)) / h;
    const designAspectShown = Math.tan((18 * Math.PI) / 180) * 1.75;
    assert.ok(freeAspectShown >= designAspectShown - 1e-3, `${freeAspectShown} < ${designAspectShown}`);
  });

  it("lifts the cars above a portrait bottom sheet and widens the narrow view", () => {
    const f = stageFraming(720, 1280, { left: 0, right: 0, top: 60, bottom: 370 });
    assert.equal(f.offsetX, 0);
    assert.equal(f.offsetY, -155);
    assert.ok(f.distScale > 1.2, `distScale ${f.distScale}`);
    assert.ok(f.fov > 36, `fov ${f.fov}`);
  });

  it("stays within the lens and distance limits for extreme covers", () => {
    const f = stageFraming(400, 900, { left: 380, right: 380, top: 800, bottom: 800 });
    assert.ok(f.fov <= 52.01, `fov ${f.fov}`);
    assert.ok(f.distScale <= 1.6, `distScale ${f.distScale}`);
    assert.ok(Number.isFinite(f.offsetX) && Number.isFinite(f.offsetY));
  });
});
