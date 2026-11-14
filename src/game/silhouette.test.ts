import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { topYAt, wheelLayout } from "./car-model.ts";

describe("car silhouettes", () => {
  it("keeps the contact layout while the bodies read as four different cars", () => {
    const vector = wheelLayout("vector");
    const surge = wheelLayout("surge");
    const vanta = wheelLayout("vanta");
    const aegis = wheelLayout("aegis");
    assert.equal(vector.wheelbase, 2.5);
    assert.ok(Math.abs(surge.wheelbase - 2.82) < 1e-9);
    assert.ok(Math.abs(vanta.wheelbase - 2.38) < 1e-9);
    assert.ok(Math.abs(aegis.halfWidth * 2 - 2.36) < 1e-9);

    const roof = (id: string) => topYAt(id, -0.08);
    const nose = (id: string) => topYAt(id, 1.7);
    assert.ok(roof("surge") < 1.05, `LMP canopy should stay low, got ${roof("surge")}`);
    assert.ok(roof("vanta") > roof("vector"), "GT4 cabin stands taller than the GT3");
    assert.ok(roof("aegis") > 1.2, "TCR roof stays tall and flat");
    assert.ok(nose("surge") < nose("vector"), "LMP nose is lower than the GT3 nose");
    assert.ok(nose("vanta") > nose("vector") + 0.08, "GT4 nose is blunt and high");
    assert.ok(nose("aegis") > nose("surge") + 0.2, "TCR nose is a tall block, not a prototype");
  });
});
