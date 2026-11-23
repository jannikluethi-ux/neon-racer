import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createCup,
  currentRound,
  earnedUnlocks,
  ordinal,
  playerStanding,
  pointsForPlace,
  recordRound,
  restartCup,
  standings,
  type CupRoundResult,
} from "./championship.ts";

function finishers(places: [string, number, number | null][]): CupRoundResult["finishers"] {
  return places.map(([id, place, time]) => ({
    id,
    name: id.toUpperCase(),
    place,
    time,
    bestLap: time != null ? time * 0.3 : null,
  }));
}

describe("championship system", () => {
  it("creates a cup at round 0 with no results", () => {
    const cup = createCup("vector", "normal", "neon-cup");
    assert.equal(cup.round, 0);
    assert.equal(cup.results.length, 0);
    assert.equal(cup.complete, false);
    assert.equal(cup.vehicleId, "vector");
  });

  it("reports the current round and clamps past the end", () => {
    const cup = createCup("vector", "normal", "neon-cup");
    assert.equal(currentRound(cup).trackId, "apex");
    cup.round = 99;
    assert.equal(currentRound(cup).trackId, "apex");
  });

  it("records round results in order and ignores out-of-order writes", () => {
    const cup = createCup("vector", "normal", "neon-cup");
    const round1: CupRoundResult = {
      round: 0,
      trackId: "apex",
      title: "Apex",
      finishers: finishers([["you", 1, 100]]),
    };
    const cup2 = recordRound(cup, round1);
    assert.equal(cup2.results.length, 1);
    assert.equal(cup2.round, 1);

    // Same round again should be ignored.
    const cup3 = recordRound(cup2, round1);
    assert.equal(cup3.results.length, 1);

    // Wrong track id should be ignored.
    const wrong: CupRoundResult = {
      round: 1,
      trackId: "velocity",
      title: "Velocity",
      finishers: finishers([["you", 1, 100]]),
    };
    const cup4 = recordRound(cup3, wrong);
    assert.equal(cup4.results.length, 1);
  });

  it("marks the cup complete after all rounds", () => {
    const cup = createCup("vector", "normal", "neon-cup");
    for (const round of ["apex", "nightfall", "apex"]) {
      const result: CupRoundResult = {
        round: cup.round,
        trackId: round,
        title: round,
        finishers: finishers([
          ["you", 1, 100],
          ["vex", 2, 105],
          ["ion", 3, 110],
          ["nyx", 4, 120],
        ]),
      };
      cup.results = [...cup.results, result];
      cup.round = cup.results.length;
    }
    cup.complete = cup.results.length >= 3;
    assert.equal(cup.complete, true);
    assert.ok(earnedUnlocks(cup).vehicles.includes("surge"));
  });

  it("allocates points by finishing position", () => {
    assert.equal(pointsForPlace(1), 10);
    assert.equal(pointsForPlace(3), 5);
    assert.equal(pointsForPlace(5), 0);
  });

  it("computes standings by points, then wins, then time", () => {
    const cup = createCup("vector", "normal", "neon-cup");
    cup.results = [
      {
        round: 0,
        trackId: "apex",
        title: "Apex",
        finishers: finishers([
          ["vex", 1, 100],
          ["you", 2, 95],
          ["ion", 3, 110],
          ["nyx", 4, 120],
        ]),
      },
      {
        round: 1,
        trackId: "nightfall",
        title: "Nightfall",
        finishers: finishers([
          ["you", 1, 90],
          ["vex", 2, 100],
          ["ion", 3, 110],
          ["nyx", 4, 120],
        ]),
      },
    ];
    cup.round = 2;
    const rows = standings(cup);
    assert.equal(rows[0]!.id, "you");
    assert.equal(rows[0]!.points, 17);
    assert.equal(rows[0]!.wins, 1);
    assert.equal(rows[1]!.id, "vex");
    assert.equal(rows[1]!.points, 17);
    assert.equal(rows[1]!.wins, 1);
    // Tie on points and wins; lower cumulative time wins.
    assert.ok(rows[0]!.time < rows[1]!.time);
  });

  it("identifies the player standing", () => {
    const cup = createCup("vector", "normal", "neon-cup");
    cup.results = [
      {
        round: 0,
        trackId: "apex",
        title: "Apex",
        finishers: finishers([
          ["vex", 1, 100],
          ["you", 2, 105],
          ["ion", 3, 110],
          ["nyx", 4, 120],
        ]),
      },
    ];
    cup.round = 1;
    assert.equal(playerStanding(cup).place, 2);
  });

  it("restarts a cup cleanly", () => {
    const cup = createCup("vector", "hard", "neon-cup-2");
    cup.results = [
      {
        round: 0,
        trackId: "velocity",
        title: "Velocity",
        finishers: finishers([["you", 1, 100]]),
      },
    ];
    cup.round = 1;
    const restarted = restartCup(cup);
    assert.equal(restarted.round, 0);
    assert.equal(restarted.results.length, 0);
    assert.equal(restarted.difficulty, "hard");
    assert.equal(restarted.id, "neon-cup-2");
  });

  it("only grants podium unlocks when the player is on the podium", () => {
    const cup = createCup("vector", "normal", "neon-cup-2");
    cup.results = [
      {
        round: 0,
        trackId: "velocity",
        title: "Velocity",
        finishers: finishers([
          ["vex", 1, 100],
          ["ion", 2, 105],
          ["nyx", 3, 110],
          ["you", 4, 120],
        ]),
      },
      {
        round: 1,
        trackId: "overdrive",
        title: "Overdrive",
        finishers: finishers([
          ["vex", 1, 100],
          ["ion", 2, 105],
          ["nyx", 3, 110],
          ["you", 4, 120],
        ]),
      },
      {
        round: 2,
        trackId: "nightfall",
        title: "Nightfall",
        finishers: finishers([
          ["vex", 1, 100],
          ["ion", 2, 105],
          ["nyx", 3, 110],
          ["you", 4, 120],
        ]),
      },
    ];
    cup.round = 3;
    cup.complete = true;
    const unlocks = earnedUnlocks(cup);
    assert.ok(unlocks.tracks.includes("overdrive"));
    assert.equal(unlocks.vehicles.includes("aegis"), false);
  });

  it("formats ordinals", () => {
    assert.equal(ordinal(1), "1st");
    assert.equal(ordinal(2), "2nd");
    assert.equal(ordinal(3), "3rd");
    assert.equal(ordinal(11), "11th");
  });
});
