import { cupById, ordinal, playerStanding, roundsOf } from "./championship";
import type { SaveData } from "./save";
import { trackById, TRACKS } from "./track-def";
import { vehicleById, VEHICLES } from "./vehicle-def";

/** This race's medal. Stored bests only ever move up. */
export type Medal = "bronze" | "silver" | "gold";

export type TrackMastery = {
  races: number;
  wins: number;
  podiums: number;
  bestPlace: number | null;
  distance: number;
  medal: Medal | "none";
};

export type CarMastery = {
  races: number;
  wins: number;
  podiums: number;
  bestPlace: number | null;
  bestRace: number | null;
  bestLap: number | null;
  distance: number;
  tracksWon: string[];
  championships: number;
};

export type CareerStats = {
  races: number;
  wins: number;
  podiums: number;
  distance: number;
  pbCount: number;
  golds: number;
  silvers: number;
  bronzes: number;
  cupsCompleted: string[];
  cupsWon: string[];
  cupPodiums: string[];
};

export type ChallengeKind =
  | "races"
  | "wins"
  | "podiums"
  | "pbs"
  | "distance"
  | "car-win"
  | "tracks-won"
  | "tracks-raced"
  | "track-gold"
  | "tracks-gold"
  | "cup-complete"
  | "cup-podium"
  | "cup-win";

export type ChallengeDef = {
  id: string;
  name: string;
  description: string;
  target: number;
  kind: ChallengeKind;
  /** Car, track, or championship id, depending on kind. */
  ref?: string;
};

export type ChallengeProgress = {
  current: number;
  /** 0 means it was already true in an older save. A later timestamp is earned in play. */
  completedAt: number | null;
};

/**
 * Alternate path to silver/gold when the place alone is not enough.
 * Winning is still gold. A slow last place stays bronze.
 * Times are full race seconds, not a single lap.
 */
export const RACE_MARKS: Record<string, { silver: number; gold: number }> = {
  apex: { silver: 250, gold: 220 },
  nightfall: { silver: 125, gold: 108 },
  velocity: { silver: 260, gold: 230 },
  overdrive: { silver: 235, gold: 210 },
};

const CAR_RULES: Record<string, { label: string; cupId: string; place: number | null }> = {
  surge: { label: "Finish Neon Cup", cupId: "neon-cup", place: null },
  aegis: { label: "Finish Neon Cup II in the top 3", cupId: "neon-cup-2", place: 3 },
};

export const CHALLENGES: readonly ChallengeDef[] = [
  { id: "first-light", name: "FIRST LIGHT", description: "Complete your first race.", target: 1, kind: "races" },
  { id: "checkered", name: "CHECKERED", description: "Win your first race.", target: 1, kind: "wins" },
  { id: "podium-habit", name: "PODIUM HABIT", description: "Finish on the podium 5 times.", target: 5, kind: "podiums" },
  { id: "winner-circle", name: "WINNER CIRCLE", description: "Win 10 races.", target: 10, kind: "wins" },
  { id: "personal", name: "PERSONAL", description: "Set your first personal best.", target: 1, kind: "pbs" },
  { id: "stopwatch", name: "STOPWATCH", description: "Set 10 personal bests.", target: 10, kind: "pbs" },
  { id: "win-vector", name: "CLEAN LINE", description: "Win a race using Vector.", target: 1, kind: "car-win", ref: "vector" },
  { id: "win-vanta", name: "REAR VIEW", description: "Win a race using Vanta.", target: 1, kind: "car-win", ref: "vanta" },
  { id: "win-surge", name: "HIGH VOLTAGE", description: "Win a race using Surge.", target: 1, kind: "car-win", ref: "surge" },
  { id: "win-aegis", name: "IRON LINE", description: "Win a race using Aegis.", target: 1, kind: "car-win", ref: "aegis" },
  { id: "four-corners", name: "FOUR CORNERS", description: "Win on 4 different tracks.", target: 4, kind: "tracks-won" },
  { id: "full-map", name: "FULL MAP", description: "Complete all 4 tracks.", target: 4, kind: "tracks-raced" },
  { id: "gold-apex", name: "APEX GOLD", description: "Earn Gold on Apex.", target: 1, kind: "track-gold", ref: "apex" },
  { id: "gold-nightfall", name: "NIGHTFALL GOLD", description: "Earn Gold on Nightfall.", target: 1, kind: "track-gold", ref: "nightfall" },
  { id: "gold-velocity", name: "VELOCITY GOLD", description: "Earn Gold on Velocity.", target: 1, kind: "track-gold", ref: "velocity" },
  { id: "gold-overdrive", name: "OVERDRIVE GOLD", description: "Earn Gold on Overdrive.", target: 1, kind: "track-gold", ref: "overdrive" },
  { id: "all-gold", name: "FULL GOLD", description: "Earn Gold on every track.", target: 4, kind: "tracks-gold" },
  { id: "neon-cup", name: "NEON CUP", description: "Complete Neon Cup.", target: 1, kind: "cup-complete", ref: "neon-cup" },
  { id: "neon-cup-2", name: "NEON CUP II", description: "Complete Neon Cup II.", target: 1, kind: "cup-complete", ref: "neon-cup-2" },
  { id: "cup-two-podium", name: "PODIUM SERIES", description: "Finish on the podium in Neon Cup II.", target: 1, kind: "cup-podium", ref: "neon-cup-2" },
  { id: "champion", name: "CHAMPION", description: "Win a championship.", target: 1, kind: "cup-win" },
  { id: "long-haul", name: "LONG HAUL", description: "Drive 20 km.", target: 20000, kind: "distance" },
];

const MEDAL_RANK: Record<Medal | "none", number> = { none: 0, bronze: 1, silver: 2, gold: 3 };

export function emptyTrackMastery(): TrackMastery {
  return { races: 0, wins: 0, podiums: 0, bestPlace: null, distance: 0, medal: "none" };
}

export function emptyCarMastery(): CarMastery {
  return {
    races: 0,
    wins: 0,
    podiums: 0,
    bestPlace: null,
    bestRace: null,
    bestLap: null,
    distance: 0,
    tracksWon: [],
    championships: 0,
  };
}

export function emptyCareer(): CareerStats {
  return {
    races: 0,
    wins: 0,
    podiums: 0,
    distance: 0,
    pbCount: 0,
    golds: 0,
    silvers: 0,
    bronzes: 0,
    cupsCompleted: [],
    cupsWon: [],
    cupPodiums: [],
  };
}

export function medalName(medal: Medal | "none"): string {
  if (medal === "gold") return "Gold";
  if (medal === "silver") return "Silver";
  if (medal === "bronze") return "Bronze";
  return "—";
}

export function medalFor(trackId: string, place: number, raceTime: number): { medal: Medal; reason: string } | null {
  if (!(raceTime > 0) || !(place > 0)) return null;
  const mark = RACE_MARKS[trackId];
  let medal: Medal = "bronze";
  let reason = "Race complete";
  if (place <= 3 || (mark != null && raceTime <= mark.silver)) {
    medal = "silver";
    reason = place <= 3 ? "Top 3 finish" : "Beat the silver time";
  }
  if (place === 1 || (mark != null && raceTime <= mark.gold)) {
    medal = "gold";
    reason = place === 1 ? "Won the race" : "Beat the gold time";
  }
  return { medal, reason };
}

export function carMedal(row: CarMastery | undefined): Medal | "none" {
  if (!row || row.races < 1) return "none";
  if (row.tracksWon.length >= 2 || row.wins >= 3) return "gold";
  if (row.podiums >= 1) return "silver";
  return "bronze";
}

export function masteryFill(medal: Medal | "none"): number {
  return MEDAL_RANK[medal] / 3;
}

function challengeValue(save: SaveData, def: ChallengeDef): number {
  const career = save.career;
  if (def.kind === "races") return career.races;
  if (def.kind === "wins") return career.wins;
  if (def.kind === "podiums") return career.podiums;
  if (def.kind === "pbs") return career.pbCount;
  if (def.kind === "distance") return career.distance;
  if (def.kind === "car-win") return save.carMastery[def.ref ?? ""]?.wins ?? 0;
  if (def.kind === "tracks-won") {
    const won = new Set<string>();
    for (const row of Object.values(save.carMastery)) for (const id of row.tracksWon) won.add(id);
    return won.size;
  }
  if (def.kind === "tracks-raced") return TRACKS.filter((track) => (save.trackMastery[track.id]?.races ?? 0) > 0).length;
  if (def.kind === "track-gold") return save.trackMastery[def.ref ?? ""]?.medal === "gold" ? 1 : 0;
  if (def.kind === "tracks-gold") return TRACKS.filter((track) => save.trackMastery[track.id]?.medal === "gold").length;
  if (def.kind === "cup-complete") return career.cupsCompleted.includes(def.ref ?? "") ? 1 : 0;
  if (def.kind === "cup-podium") return career.cupPodiums.includes(def.ref ?? "") ? 1 : 0;
  if (def.kind === "cup-win") return career.cupsWon.length;
  return 0;
}

/** Marks challenges that the current career already proves. Does not invent race counts. */
export function syncChallenges(save: SaveData, now: number): ChallengeDef[] {
  const fresh: ChallengeDef[] = [];
  const next: Record<string, ChallengeProgress> = { ...save.challenges };
  for (const def of CHALLENGES) {
    const current = Math.min(def.target, Math.max(0, challengeValue(save, def)));
    const prev = next[def.id] ?? { current: 0, completedAt: null };
    const done = prev.completedAt != null || current >= def.target;
    const completedAt = prev.completedAt != null ? prev.completedAt : done ? now : null;
    if (prev.completedAt == null && completedAt != null) fresh.push(def);
    next[def.id] = { current: Math.max(prev.current, current), completedAt };
  }
  save.challenges = next;
  return fresh;
}

/**
 * Old saves can prove a finished cup via unlocks or a stored championship.
 * This never invents wins, medals, or race totals.
 */
export function proveCareer(save: SaveData): void {
  const cups = new Set(save.career.cupsCompleted);
  const podiums = new Set(save.career.cupPodiums);
  const won = new Set(save.career.cupsWon);
  if (save.unlockedTracks.includes("velocity") || save.unlockedVehicles.includes("surge")) cups.add("neon-cup");
  if (save.unlockedTracks.includes("overdrive")) cups.add("neon-cup-2");
  if (save.unlockedVehicles.includes("aegis")) {
    cups.add("neon-cup-2");
    podiums.add("neon-cup-2");
  }
  const cup = save.championship;
  if (cup?.complete) {
    cups.add(cup.id);
    const place = playerStanding(cup).place;
    if (place <= 3) podiums.add(cup.id);
    if (place === 1) won.add(cup.id);
    const car = save.carMastery[cup.vehicleId];
    if (car && car.championships < 1) car.championships = 1;
  }
  save.career.cupsCompleted = [...cups];
  save.career.cupPodiums = [...podiums];
  save.career.cupsWon = [...won];
}

export type RaceFact = {
  trackId: string;
  vehicleId: string;
  place: number;
  raceTime: number;
  bestLap: number | null;
  avg: number | null;
  distance: number;
  cup: { id: string; place: number } | null;
};

export type RaceNotes = {
  newLap: boolean;
  newRace: boolean;
  previousLap: number | null;
  previousRace: number | null;
};

export type RaceSummary = {
  medal: Medal | null;
  reason: string;
  trackMedal: Medal | "none";
  trackName: string;
  vehicleName: string;
  vehicleRaces: number;
  vehicleWins: number;
  improvedMedal: boolean;
  won: boolean;
  podium: boolean;
  newChallenges: { id: string; name: string }[];
  previousLap: number | null;
  previousRace: number | null;
};

function bumpPlace(current: number | null, place: number): number | null {
  if (!(place > 0)) return current;
  if (current == null || place < current) return place;
  return current;
}

/** Applies one finished race. A DNF leaves mastery untouched. */
export function applyProgress(save: SaveData, fact: RaceFact, notes: RaceNotes): RaceSummary | null {
  if (!(fact.raceTime > 0) || !(fact.place > 0)) return null;
  const awarded = medalFor(fact.trackId, fact.place, fact.raceTime);
  if (!awarded) return null;
  const track = (save.trackMastery[fact.trackId] ??= emptyTrackMastery());
  const car = (save.carMastery[fact.vehicleId] ??= emptyCarMastery());
  const career = save.career;
  const won = fact.place === 1;
  const podium = fact.place <= 3;
  const prevMedal = track.medal;
  const nextMedal = MEDAL_RANK[awarded.medal] > MEDAL_RANK[track.medal] ? awarded.medal : track.medal;

  track.races += 1;
  track.distance += Math.max(0, fact.distance);
  if (won) track.wins += 1;
  if (podium) track.podiums += 1;
  track.bestPlace = bumpPlace(track.bestPlace, fact.place);
  track.medal = nextMedal;

  car.races += 1;
  car.distance += Math.max(0, fact.distance);
  if (won) car.wins += 1;
  if (podium) car.podiums += 1;
  car.bestPlace = bumpPlace(car.bestPlace, fact.place);
  if (fact.raceTime > 0 && (car.bestRace == null || fact.raceTime < car.bestRace)) car.bestRace = fact.raceTime;
  if (fact.bestLap != null && fact.bestLap > 0 && (car.bestLap == null || fact.bestLap < car.bestLap)) car.bestLap = fact.bestLap;
  if (won && !car.tracksWon.includes(fact.trackId)) car.tracksWon = [...car.tracksWon, fact.trackId];

  career.races += 1;
  career.distance += Math.max(0, fact.distance);
  if (won) career.wins += 1;
  if (podium) career.podiums += 1;
  if (awarded.medal === "gold") career.golds += 1;
  else if (awarded.medal === "silver") career.silvers += 1;
  else career.bronzes += 1;
  if (notes.newLap) career.pbCount += 1;
  if (notes.newRace) career.pbCount += 1;

  const record = save.trackRecords[fact.trackId];
  if (record) {
    if (notes.newLap) record.bestLapCar = fact.vehicleId;
    if (notes.newRace) record.bestRaceCar = fact.vehicleId;
    if (fact.avg != null && fact.avg > 0 && (record.bestAvg == null || fact.avg > record.bestAvg)) {
      record.bestAvg = fact.avg;
      record.bestAvgCar = fact.vehicleId;
    }
  }

  if (fact.cup) {
    if (!career.cupsCompleted.includes(fact.cup.id)) career.cupsCompleted = [...career.cupsCompleted, fact.cup.id];
    if (fact.cup.place <= 3 && !career.cupPodiums.includes(fact.cup.id)) career.cupPodiums = [...career.cupPodiums, fact.cup.id];
    if (fact.cup.place === 1 && !career.cupsWon.includes(fact.cup.id)) career.cupsWon = [...career.cupsWon, fact.cup.id];
    car.championships += 1;
  }

  const fresh = syncChallenges(save, Date.now());
  return {
    medal: awarded.medal,
    reason: awarded.reason,
    trackMedal: track.medal,
    trackName: trackById(fact.trackId).name,
    vehicleName: vehicleById(fact.vehicleId).name,
    vehicleRaces: car.races,
    vehicleWins: car.wins,
    improvedMedal: nextMedal !== prevMedal,
    won,
    podium,
    newChallenges: fresh.map((row) => ({ id: row.id, name: row.name })),
    previousLap: notes.previousLap,
    previousRace: notes.previousRace,
  };
}

export function challengeLine(def: ChallengeDef, progress: ChallengeProgress | undefined): string {
  const current = progress?.current ?? 0;
  if (def.kind === "distance") return `${(current / 1000).toFixed(1)} / ${(def.target / 1000).toFixed(0)} km`;
  return `${Math.min(current, def.target)} / ${def.target}`;
}

export function goldCount(save: SaveData): number {
  return TRACKS.filter((track) => save.trackMastery[track.id]?.medal === "gold").length;
}

export function carsMastered(save: SaveData): number {
  return VEHICLES.filter((car) => carMedal(save.carMastery[car.id]) === "gold").length;
}

export function challengesDone(save: SaveData): number {
  return CHALLENGES.filter((def) => save.challenges[def.id]?.completedAt != null).length;
}

export function favoriteCar(save: SaveData): string | null {
  let best: string | null = null;
  let races = 0;
  let wins = 0;
  for (const car of VEHICLES) {
    const row = save.carMastery[car.id];
    const n = row?.races ?? 0;
    const w = row?.wins ?? 0;
    if (n > races || (n === races && n > 0 && w > wins)) {
      races = n;
      wins = w;
      best = car.id;
    }
  }
  return races > 0 ? best : null;
}

export function favoriteTrack(save: SaveData): string | null {
  let best: string | null = null;
  let races = 0;
  for (const track of TRACKS) {
    const n = save.trackMastery[track.id]?.races ?? 0;
    if (n > races) {
      races = n;
      best = track.id;
    }
  }
  return best;
}

export function fastestLap(save: SaveData): { time: number; trackId: string; carId: string | null } | null {
  let best: { time: number; trackId: string; carId: string | null } | null = null;
  for (const track of TRACKS) {
    const row = save.trackRecords[track.id];
    if (row?.bestLap != null && row.bestLap > 0 && (best == null || row.bestLap < best.time)) {
      best = { time: row.bestLap, trackId: track.id, carId: row.bestLapCar };
    }
  }
  return best;
}

export function fastestRace(save: SaveData): { time: number; trackId: string; carId: string | null } | null {
  let best: { time: number; trackId: string; carId: string | null } | null = null;
  for (const track of TRACKS) {
    const row = save.trackRecords[track.id];
    if (row?.bestRace != null && row.bestRace > 0 && (best == null || row.bestRace < best.time)) {
      best = { time: row.bestRace, trackId: track.id, carId: row.bestRaceCar };
    }
  }
  return best;
}

function cupProgress(save: SaveData, cupId: string): string {
  const name = cupById(cupId)?.name ?? "Cup";
  const cup = save.championship;
  if (cup && cup.id === cupId) {
    if (cup.results.length > 0) {
      const place = ordinal(playerStanding(cup).place);
      if (cup.complete) return `${place} in ${name}`;
      return `${place} · round ${cup.round + 1} / ${roundsOf(cup).length}`;
    }
    return cup.complete ? `${name} finished` : `Round 1 / ${roundsOf(cup).length}`;
  }
  if (save.career.cupsCompleted.includes(cupId)) return `${name} finished`;
  return "Not started";
}

export function carRequirement(id: string, save: SaveData): { requirement: string; progress: string } | null {
  const rule = CAR_RULES[id];
  if (!rule) return null;
  let progress = cupProgress(save, rule.cupId);
  if (rule.place != null && save.unlockedTracks.includes("overdrive") && !save.unlockedVehicles.includes(id) && progress === "Neon Cup II finished") {
    progress = "Neon Cup II finished — top 3 still needed";
  }
  return { requirement: rule.label, progress };
}

export function trackRequirement(id: string, save: SaveData): { requirement: string; progress: string } | null {
  const track = trackById(id);
  if (track.startsUnlocked) return null;
  const requirement = track.lockedHint ?? "Locked";
  if (track.lockAfterTrack) {
    const prior = trackById(track.lockAfterTrack);
    const done = (save.trackRecords[track.lockAfterTrack]?.bestRace ?? 0) > 0;
    return { requirement, progress: done ? `${prior.name} finished` : `${prior.name} not finished yet` };
  }
  if (track.lockCup) return { requirement, progress: cupProgress(save, track.lockCup) };
  return { requirement, progress: "Not started" };
}
