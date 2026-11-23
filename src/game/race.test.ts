import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkGate, rankCars, respawnCar, sectorProgress, timeGapSeconds } from "./race.ts";
import { buildTrack } from "./track.ts";
import { carFixture, placeOnTrack } from "./test-fixtures.ts";

describe("race system", () => {
  it("ranks finished cars by finish place, then live cars by lap/gate/sector", () => {
    const cars = [
      carFixture({ id: "a", finished: true, finishPlace: 2, laps: 3, nextGate: 0, sector: 0 }),
      carFixture({ id: "b", finished: true, finishPlace: 1, laps: 3, nextGate: 0, sector: 0 }),
      carFixture({ id: "c", finished: false, laps: 2, nextGate: 5, sector: 0.8 }),
      carFixture({ id: "d", finished: false, laps: 2, nextGate: 5, sector: 0.5 }),
    ];
    const ranked = rankCars(cars).map((c) => c.id);
    assert.deepEqual(ranked, ["b", "a", "c", "d"]);
  });

  it("sector progress is zero when reversing or before previous gate", () => {
    const track = buildTrack();
    const car = carFixture();
    car.arc = 100;
    car.forwardSpeed = -5;
    assert.equal(sectorProgress(car, track), 0);
  });

  it("detects checkpoint crossing and lap completion", () => {
    const track = buildTrack();
    const gate = track.gates[0]!;
    const car = carFixture();
    car.prevX = gate.x - gate.tx * 5;
    car.prevZ = gate.z - gate.tz * 5;
    car.x = gate.x + gate.tx * 2;
    car.z = gate.z + gate.tz * 2;
    car.nextGate = 0;
    car.arc = gate.arc;
    const result = checkGate(car, track);
    assert.equal(result, "gate");
    assert.equal(car.nextGate, 1);

    const last = track.gates[track.gates.length - 1]!;
    car.nextGate = track.gates.length - 1;
    car.prevX = last.x - last.tx * 5;
    car.prevZ = last.z - last.tz * 5;
    car.x = last.x + last.tx * 2;
    car.z = last.z + last.tz * 2;
    car.arc = last.arc;
    const lap = checkGate(car, track);
    assert.equal(lap, "lap");
    assert.equal(car.nextGate, 0);
  });

  it("ignores checkpoint crossing from the wrong direction", () => {
    const track = buildTrack();
    const gate = track.gates[0]!;
    const car = carFixture();
    car.prevX = gate.x + gate.tx * 5;
    car.prevZ = gate.z + gate.tz * 5;
    car.x = gate.x - gate.tx * 2;
    car.z = gate.z - gate.tz * 2;
    car.nextGate = 0;
    assert.equal(checkGate(car, track), "none");
  });

  it("ignores checkpoint crossing too far laterally", () => {
    const track = buildTrack();
    const gate = track.gates[0]!;
    const car = carFixture();
    car.prevX = gate.x - gate.tx * 5;
    car.prevZ = gate.z - gate.tz * 5;
    car.x = gate.x + gate.tx * 2;
    car.z = gate.z + gate.tz * 2;
    car.nextGate = 0;
    car.x += gate.rx * (gate.half + 5);
    car.z += gate.rz * (gate.half + 5);
    assert.equal(checkGate(car, track), "none");
  });

  it("computes time gaps in seconds", () => {
    const a = carFixture({ raceDist: 100, forwardSpeed: 40 });
    const b = carFixture({ raceDist: 220, forwardSpeed: 40 });
    const gap = timeGapSeconds(a, b);
    assert.ok(gap > 2.9 && gap < 3.1, `gap ${gap}`);
  });

  it("respawns a car onto the track", () => {
    const track = buildTrack();
    const car = carFixture();
    placeOnTrack(car, track, 200);
    car.respawnArc = 200;
    car.forwardSpeed = 80;
    car.arc = 500;
    const before = { x: car.x, z: car.z, arc: car.arc };
    respawnCar(car, track);
    assert.notEqual(car.x, before.x);
    assert.ok(Math.abs(car.arc - before.arc) > 5);
    assert.ok(car.forwardSpeed <= 25);
    assert.equal(car.stuck, 0);
    assert.equal(car.airborne, false);
  });
});
