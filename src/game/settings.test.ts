import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { mapSteeringWheelRotation, resolveThrottle, STEERING_WHEEL_LIMIT } from "./input.ts";
import { defaultSave, loadSave, normalizeSave, writeSave, type SaveData } from "./save.ts";

describe("touch input mapping", () => {
  it("maps wheel rotation proportionally with a small centre dead zone", () => {
    assert.equal(mapSteeringWheelRotation(0), 0);
    assert.equal(mapSteeringWheelRotation((4 * Math.PI) / 180), 0);
    assert.equal(mapSteeringWheelRotation(STEERING_WHEEL_LIMIT), -1);
    assert.equal(mapSteeringWheelRotation(-STEERING_WHEEL_LIMIT), 1);
    assert.ok(Math.abs(mapSteeringWheelRotation(STEERING_WHEEL_LIMIT * 0.5) + 0.4565) < 0.001);
  });

  it("holds throttle automatically while allowing the brake to override it", () => {
    assert.equal(resolveThrottle(0, 0, true), 1);
    assert.equal(resolveThrottle(0.42, 0, false), 0.42);
    assert.equal(resolveThrottle(1, 1, true), 0);
  });
});

describe("auto-accelerate save setting", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });

  after(() => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });

  it("uses the device default for older saves and preserves an explicit choice", () => {
    const oldSave = { ...defaultSave, settings: { quality: "medium" as const } } as unknown as Partial<SaveData>;
    assert.equal(normalizeSave(oldSave, true).settings.autoAccelerate, true);
    assert.equal(normalizeSave(oldSave, false).settings.autoAccelerate, false);
    const saved = { ...defaultSave, settings: { ...defaultSave.settings, autoAccelerate: true } };
    assert.equal(normalizeSave(saved, false).settings.autoAccelerate, true);
  });

  it("persists an explicit auto-accelerate choice across a save load", () => {
    const data = { ...defaultSave, settings: { ...defaultSave.settings, autoAccelerate: true } };
    writeSave(data);
    assert.equal(loadSave().settings.autoAccelerate, true);
  });
});
