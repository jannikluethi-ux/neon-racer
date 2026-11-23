import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPad, buildTrack, projectInto, sampleAt, sampleIndexAt } from "./track.ts";
import type { Projection } from "./track.ts";

describe("track system", () => {
  it("builds a track with positive length and samples", () => {
    const track = buildTrack();
    assert.ok(track.length > 1000);
    assert.ok(track.samples.length > 100);
    assert.ok(track.gates.length >= 6);
    assert.ok(track.samples.every((s) => s.segLen > 0));
  });

  it("links every checkpoint to the next gate, wrapping to zero", () => {
    const track = buildTrack();
    for (let i = 0; i < track.gates.length; i++) {
      const gate = track.gates[i]!;
      assert.equal(gate.next, (i + 1) % track.gates.length);
    }
    assert.equal(track.gates[track.gates.length - 1]!.next, 0);
  });

  it("samples at negative and over-length arcs wrap correctly", () => {
    const track = buildTrack();
    const base = sampleAt(track, 100);
    const under = sampleAt(track, 100 - track.length);
    const over = sampleAt(track, 100 + track.length);
    assert.equal(base.dist, under.dist);
    assert.equal(base.dist, over.dist);
  });

  it("sampleIndexAt clamps to valid indices", () => {
    const track = buildTrack();
    assert.equal(sampleIndexAt(track, 0), 0);
    assert.ok(sampleIndexAt(track, track.length * 0.5) >= 0);
    assert.ok(sampleIndexAt(track, track.length * 0.5) < track.samples.length);
  });

  it("projects a point near the track centre", () => {
    const track = buildTrack();
    const s = sampleAt(track, 200);
    const out: Projection = {
      sampleIndex: 0,
      x: 0,
      y: 0,
      z: 0,
      tx: 0,
      ty: 0,
      tz: 0,
      rx: 0,
      rz: 0,
      lat: 0,
      arc: 0,
      width: 16,
      curv: 0,
      jump: false,
    };
    projectInto(track, s.x, s.z, -1, out);
    assert.ok(Math.abs(out.lat) < 1);
    assert.ok(Math.abs(out.arc - s.dist) < 1);
  });

  it("builds the pad as a closed loop", () => {
    const pad = buildPad();
    assert.ok(pad.length > 100);
    assert.ok(pad.samples.length > 50);
    assert.ok(pad.gates.length >= 4);
  });
});
