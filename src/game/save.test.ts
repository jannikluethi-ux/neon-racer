import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  commitFinish,
  defaultSave,
  isTrackUnlocked,
  isVehicleUnlocked,
  loadSave,
  normalizeSave,
  SAVE_VERSION,
  writeSave,
  type SaveData,
} from "./save.ts";
import { applyProgress, type RaceFact, type RaceNotes } from "./mastery.ts";

describe("save system", () => {
  it("normalizes missing save data to defaults", () => {
    const save = normalizeSave(null);
    assert.equal(save.saveVersion, SAVE_VERSION);
    assert.equal(save.selectedVehicle, "vector");
    assert.equal(save.selectedTrack, "apex");
    assert.ok(save.unlockedVehicles.includes("vector"));
  });

  it("cleans invalid vehicle and track ids", () => {
    const save = normalizeSave({
      selectedVehicle: "not-a-car",
      selectedTrack: "not-a-track",
    } as Partial<SaveData>);
    assert.equal(save.selectedVehicle, "vector");
    assert.equal(save.selectedTrack, "apex");
  });

  it("clamps settings to allowed ranges", () => {
    const save = normalizeSave({
      settings: { quality: "medium", volume: 2, steerSens: 0, touch: "auto", autoAccelerate: false, difficulty: "normal" },
    } as Partial<SaveData>);
    assert.equal(save.settings.volume, 1);
    assert.equal(save.settings.steerSens, 0.6);
  });

  it("migrates legacy v1 saves", () => {
    const save = normalizeSave({ version: 1, bestLap: 123, bestTime: 456 });
    assert.equal(save.trackRecords.apex?.bestLap, 123);
    assert.equal(save.trackRecords.apex?.bestRace, 456);
  });

  it("ignores championships with unknown cup ids", () => {
    const save = normalizeSave({
      championship: { id: "fake-cup", vehicleId: "vector", difficulty: "normal", round: 0, results: [], complete: false },
    } as Partial<SaveData>);
    assert.equal(save.championship, null);
  });

  it("records a finish and unlocks the track reward", () => {
    const save = normalizeSave(defaultSave);
    const commit = commitFinish(save, "apex", 200, 65, [50, 55, 60, 65]);
    assert.equal(commit.newRace, true);
    assert.equal(commit.newLap, true);
    assert.equal(commit.freshUnlock, "NIGHTFALL");
    assert.ok(commit.save.trackRecords.apex!.bestRace! <= 200);
    assert.ok(commit.save.trackRecords.apex!.bestLap! <= 65);
  });

  it("does not update records with slower times", () => {
    let save = normalizeSave(defaultSave);
    save = commitFinish(save, "apex", 200, 65, []).save;
    const commit = commitFinish(save, "apex", 210, 70, []);
    assert.equal(commit.newRace, false);
    assert.equal(commit.newLap, false);
  });

  it("applies race progress to mastery and career", () => {
    const save = normalizeSave(defaultSave);
    const fact: RaceFact = {
      trackId: "apex",
      vehicleId: "vector",
      place: 1,
      raceTime: 200,
      bestLap: 65,
      avg: 50,
      distance: 3000,
      cup: null,
    };
    const notes: RaceNotes = { newLap: true, newRace: true, previousLap: null, previousRace: null };
    const summary = applyProgress(save, fact, notes);
    assert.ok(summary);
    assert.equal(summary!.won, true);
    assert.equal(summary!.trackMedal, "gold");
    assert.equal(save.career.races, 1);
    assert.equal(save.career.wins, 1);
    assert.equal(save.trackMastery.apex?.races, 1);
    assert.equal(save.carMastery.vector?.wins, 1);
  });

  it("rejects DNF progress", () => {
    const save = normalizeSave(defaultSave);
    const fact: RaceFact = {
      trackId: "apex",
      vehicleId: "vector",
      place: 0,
      raceTime: 0,
      bestLap: null,
      avg: null,
      distance: 0,
      cup: null,
    };
    const summary = applyProgress(save, fact, { newLap: false, newRace: false, previousLap: null, previousRace: null });
    assert.equal(summary, null);
    assert.equal(save.career.races, 0);
  });

  it("checks unlock state", () => {
    const save = normalizeSave(defaultSave);
    assert.equal(isVehicleUnlocked("vector", save), true);
    assert.equal(isVehicleUnlocked("surge", save), false);
    assert.equal(isTrackUnlocked("apex", save), true);
    assert.equal(isTrackUnlocked("velocity", save), false);
  });

  describe("localStorage round-trip", () => {
    let original: unknown;
    const store = new Map<string, string>();

    beforeEach(() => {
      original = (globalThis as { localStorage?: unknown }).localStorage;
      (globalThis as { localStorage?: unknown }).localStorage = {
        getItem(key: string) {
          return store.has(key) ? store.get(key)! : null;
        },
        setItem(key: string, value: string) {
          store.set(key, value);
        },
        removeItem(key: string) {
          store.delete(key);
        },
      };
    });

    afterEach(() => {
      (globalThis as { localStorage?: unknown }).localStorage = original;
      store.clear();
    });

    it("writes and reads a save", () => {
      const save = normalizeSave(defaultSave);
      writeSave(save);
      const loaded = loadSave();
      assert.equal(loaded.selectedVehicle, save.selectedVehicle);
      assert.equal(loaded.saveVersion, SAVE_VERSION);
    });
  });
});
