import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  KERB_CROWN,
  KERB_FRONT,
  KERB_OFF,
  KERB_OUT,
  KERB_W,
  STUD_HALF_H,
  kerbRunIndices,
  kerbStudCenterLift,
  kerbStudLat,
  kerbStudSurface,
  kerbSurfaceAt,
  kerbWeightProfile,
} from "./kerb.ts";
import { ROAD_DECK_Y } from "./contact.ts";
import { buildCourse } from "./track.ts";

const HALF = 8;

describe("kerb studs", () => {
  it("sits on the centre of the kerb band, not a mis-scaled half-width", () => {
    const lat = kerbStudLat(HALF);
    const inner = HALF - KERB_W;
    const outer = HALF + KERB_OUT;
    assert.ok(Math.abs(lat - (inner + outer) / 2) < 1e-9);
    // The old call passed 0.36 as both lat and road half, which is not this point.
    assert.notEqual(lat, KERB_W * 0.5);
  });

  it("rests on the asphalt on a straight", () => {
    assert.equal(kerbStudSurface(HALF, 0), 0);
    assert.equal(kerbStudCenterLift(HALF, 0), STUD_HALF_H);
    const bottom = kerbStudCenterLift(HALF, 0) - STUD_HALF_H;
    assert.equal(bottom, 0);
  });

  it("follows the kerb profile through a corner", () => {
    const surface = kerbStudSurface(HALF, 1);
    assert.ok(surface > KERB_FRONT - 1e-9);
    assert.ok(surface < KERB_CROWN + 1e-9);
    const bottom = kerbStudCenterLift(HALF, 1) - STUD_HALF_H;
    assert.ok(Math.abs(bottom - surface) < 1e-9, "stud bottom must meet the kerb, not float or bury");
    // Same lateral line as a straight — only the height changes.
    assert.equal(kerbStudLat(HALF), kerbStudLat(HALF));
    assert.equal(kerbSurfaceAt(kerbStudLat(HALF), HALF, 1), surface);
  });

  it("uses the real road half-width, so a wide and a narrow road do not share a fake 0.36 m half", () => {
    const wide = kerbStudSurface(9, 1);
    const narrow = kerbStudSurface(6, 1);
    // The profile is relative to the edge, so the centre-band height matches.
    assert.ok(Math.abs(wide - narrow) < 1e-9);
    assert.notEqual(kerbStudLat(9), kerbStudLat(6));
  });

  it("places studs on representative straight and curved runs on all four circuits", () => {
    for (const id of ["apex", "nightfall", "velocity", "overdrive"] as const) {
      const track = buildCourse(id);
      const weights = kerbWeightProfile(track.samples);
      const straightIndex = track.samples.reduce(
        (best, sample, i, samples) =>
          Math.abs(sample.curv) < Math.abs(samples[best]!.curv) ? i : best,
        0,
      );
      assert.ok(Math.abs(track.samples[straightIndex]!.curv) <= KERB_OFF, `${id} needs a straight sample`);
      assert.equal(weights[straightIndex], 0, `${id} straight sample must not invent a kerb lift`);
      const straight = track.samples[straightIndex]!;
      const straightBottom = ROAD_DECK_Y + kerbStudCenterLift(straight.width * 0.5, weights[straightIndex]!) - STUD_HALF_H;
      assert.ok(Math.abs(straightBottom - ROAD_DECK_Y) < 1e-9, `${id} straight stud bottom must meet asphalt`);

      const curvedIndices = kerbRunIndices(track.samples).flat();
      assert.ok(curvedIndices.length > 0, `${id} must have a retained kerb run`);
      const curveIndex = curvedIndices.reduce((best, i) => (weights[i]! > weights[best]! ? i : best), curvedIndices[0]!);
      const curve = track.samples[curveIndex]!;
      const half = curve.width * 0.5;
      const weight = weights[curveIndex]!;
      const lat = kerbStudLat(half);
      const surface = kerbSurfaceAt(lat, half, weight);
      const bottom = kerbStudCenterLift(half, weight) - STUD_HALF_H;
      assert.ok(Math.abs(bottom - surface) < 1e-9, `${id} curved stud bottom must match its profile`);
      assert.ok(surface >= KERB_FRONT - 1e-9 && surface <= KERB_CROWN + 1e-9);
      assert.ok(Math.abs((curve.y + ROAD_DECK_Y + bottom) - (curve.y + ROAD_DECK_Y + surface)) < 1e-9);
    }
  });
});
