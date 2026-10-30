import type { AiDifficulty } from "./tuning";
import { vehicleById } from "./vehicle-def";

/** Finishing-position points only. Not nitro, laps, or collisions. */
export const CUP_POINTS = [
  { place: 1, points: 10 },
  { place: 2, points: 7 },
  { place: 3, points: 5 },
  { place: 4, points: 3 },
] as const;

export type CupRound = { trackId: string; title: string };

export type CupReward = {
  tracks: readonly string[];
  vehicles: readonly string[];
};

export type CupDefinition = {
  id: string;
  name: string;
  blurb: string;
  rounds: readonly CupRound[];
  /** Granted when the cup is finished, whatever the place. */
  onComplete: CupReward;
  /** Granted only when the player finishes the cup in the top 3. */
  onPodium: CupReward;
};

export const NEON_CUP: CupDefinition = {
  id: "neon-cup",
  name: "Neon Cup",
  blurb: "Apex, Nightfall, then Apex again. One car. Points from where you finish.",
  rounds: [
    { trackId: "apex", title: "Apex" },
    { trackId: "nightfall", title: "Nightfall" },
    { trackId: "apex", title: "Apex — Final Run" },
  ],
  onComplete: { tracks: ["velocity"], vehicles: ["surge"] },
  onPodium: { tracks: [], vehicles: [] },
};

export const NEON_CUP_II: CupDefinition = {
  id: "neon-cup-2",
  name: "Neon Cup II",
  blurb: "Velocity, Overdrive, then Nightfall. High speed, then nowhere to hide.",
  rounds: [
    { trackId: "velocity", title: "Velocity" },
    { trackId: "overdrive", title: "Overdrive" },
    { trackId: "nightfall", title: "Nightfall" },
  ],
  onComplete: { tracks: ["overdrive"], vehicles: [] },
  onPodium: { tracks: [], vehicles: ["aegis"] },
};

export const CUPS: readonly CupDefinition[] = [NEON_CUP, NEON_CUP_II];

export function cupById(id: string | undefined): CupDefinition | undefined {
  return CUPS.find((cup) => cup.id === id);
}

const ENTRANTS = ["you", "vex", "ion", "nyx"] as const;
const DNF_PENALTY = 100000;

export type CupFinisher = {
  id: string;
  name: string;
  place: number;
  time: number | null;
  bestLap: number | null;
};

export type CupRoundResult = {
  round: number;
  trackId: string;
  title: string;
  finishers: CupFinisher[];
};

export type ActiveChampionship = {
  id: string;
  vehicleId: string;
  difficulty: AiDifficulty;
  /** Next round to race. Equals the round count when the cup is complete. */
  round: number;
  results: CupRoundResult[];
  complete: boolean;
};

export type StandingRow = {
  id: string;
  name: string;
  points: number;
  wins: number;
  time: number;
  bestLap: number | null;
  place: number;
  isPlayer: boolean;
};

export function pointsForPlace(place: number): number {
  return CUP_POINTS.find((row) => row.place === place)?.points ?? 0;
}

export function ordinal(n: number): string {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}

export function roundsOf(cup: { id: string }): readonly CupRound[] {
  return cupById(cup.id)?.rounds ?? NEON_CUP.rounds;
}

export function createCup(vehicleId: string, difficulty: AiDifficulty, cupId = NEON_CUP.id): ActiveChampionship {
  const def = cupById(cupId) ?? NEON_CUP;
  return {
    id: def.id,
    vehicleId,
    difficulty,
    round: 0,
    results: [],
    complete: false,
  };
}

export function restartCup(cup: ActiveChampionship): ActiveChampionship {
  return createCup(cup.vehicleId, cup.difficulty, cup.id);
}

export function currentRound(cup: ActiveChampionship): CupRound {
  const rounds = roundsOf(cup);
  return rounds[Math.min(cup.round, rounds.length - 1)]!;
}

/** Records one finished round. Ignores a second write for the same round. */
export function recordRound(cup: ActiveChampionship, result: CupRoundResult): ActiveChampionship {
  const rounds = roundsOf(cup);
  if (cup.complete || cup.results.length !== cup.round) return cup;
  const expected = rounds[cup.round];
  if (!expected || result.trackId !== expected.trackId) return cup;
  const results = [...cup.results, { ...result, round: cup.round, title: expected.title }];
  const complete = results.length >= rounds.length;
  return {
    ...cup,
    results,
    round: results.length,
    complete,
  };
}

function defaultName(id: string, vehicleId: string): string {
  if (id === "you") return vehicleById(vehicleId).name;
  if (id === "vex") return "VEX";
  if (id === "ion") return "ION";
  if (id === "nyx") return "NYX";
  return id;
}

/** Points, then wins, then cumulative time. A DNF is a large time penalty, never a free pass. */
export function standings(cup: ActiveChampionship): StandingRow[] {
  const rows = ENTRANTS.map((id) => {
    let points = 0;
    let wins = 0;
    let time = 0;
    let bestLap: number | null = null;
    let name = defaultName(id, cup.vehicleId);
    for (const result of cup.results) {
      const finisher = result.finishers.find((row) => row.id === id);
      if (!finisher) continue;
      name = finisher.name || name;
      points += pointsForPlace(finisher.place);
      if (finisher.place === 1) wins += 1;
      time += finisher.time != null && finisher.time > 0 ? finisher.time : DNF_PENALTY;
      if (finisher.bestLap != null && finisher.bestLap > 0 && (bestLap == null || finisher.bestLap < bestLap)) {
        bestLap = finisher.bestLap;
      }
    }
    return { id, name, points, wins, time, bestLap, place: 0, isPlayer: id === "you" };
  });
  rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (a.time !== b.time) return a.time - b.time;
    return ENTRANTS.indexOf(a.id as (typeof ENTRANTS)[number]) - ENTRANTS.indexOf(b.id as (typeof ENTRANTS)[number]);
  });
  rows.forEach((row, index) => {
    row.place = index + 1;
  });
  return rows;
}

export function racedSeconds(time: number): number | null {
  const raced = time % 100000;
  if (time >= 100000 && raced === 0) return null;
  return raced;
}

export function playerStanding(cup: ActiveChampionship): StandingRow {
  return standings(cup).find((row) => row.isPlayer) ?? standings(cup)[0]!;
}

/** Unlocks earned by a finished cup. Empty until the cup is complete. */
export function earnedUnlocks(cup: ActiveChampionship): { tracks: string[]; vehicles: string[] } {
  const def = cupById(cup.id);
  if (!def || !cup.complete) return { tracks: [], vehicles: [] };
  const tracks = [...def.onComplete.tracks];
  const vehicles = [...def.onComplete.vehicles];
  if (playerStanding(cup).place <= 3) {
    tracks.push(...def.onPodium.tracks);
    vehicles.push(...def.onPodium.vehicles);
  }
  return { tracks, vehicles };
}
