import { cupById, type ActiveChampionship, type CupRoundResult } from "./championship";
import {
  emptyCareer,
  proveCareer,
  syncChallenges,
  type CarMastery,
  type CareerStats,
  type ChallengeProgress,
  type Medal,
  type TrackMastery,
} from "./mastery";
import { trackById, TRACKS } from "./track-def";
import { VEHICLES, vehicleById } from "./vehicle-def";

export type Quality = "low" | "medium" | "high";
export type TouchMode = "auto" | "on" | "off";
export type AiDifficulty = "easy" | "normal" | "hard";

export type TrackRecord = {
  bestLap: number | null;
  bestRace: number | null;
  /** Best known four-way split times for this circuit. Zero means unset. */
  bestSectors: number[];
  bestLapCar: string | null;
  bestRaceCar: string | null;
  bestAvg: number | null;
  bestAvgCar: string | null;
};

export type SaveSettings = {
  quality: Quality;
  volume: number;
  steerSens: number;
  touch: TouchMode;
  difficulty: AiDifficulty;
};

export type SaveData = {
  saveVersion: number;
  unlockedVehicles: string[];
  unlockedTracks: string[];
  selectedVehicle: string;
  selectedTrack: string;
  trackRecords: Record<string, TrackRecord>;
  settings: SaveSettings;
  /** In-progress or finished championship. Null when the player is not in a cup. */
  championship: ActiveChampionship | null;
  trackMastery: Record<string, TrackMastery>;
  carMastery: Record<string, CarMastery>;
  career: CareerStats;
  challenges: Record<string, ChallengeProgress>;
};

export const SAVE_VERSION = 4;
const KEY = "neon-racer-save";
const LEGACY_KEY = "neon-racer-v1";

type LegacyV1 = {
  version: 1;
  quality?: Quality;
  volume?: number;
  steerSens?: number;
  touch?: TouchMode;
  bestTime?: number | null;
  bestLap?: number | null;
  difficulty?: AiDifficulty;
};

export const defaultSave: SaveData = {
  saveVersion: SAVE_VERSION,
  unlockedVehicles: VEHICLES.filter((car) => car.startsUnlocked).map((car) => car.id),
  unlockedTracks: TRACKS.filter((track) => track.startsUnlocked).map((track) => track.id),
  selectedVehicle: "vector",
  selectedTrack: "apex",
  trackRecords: {},
  settings: {
    quality: "medium",
    volume: 0.8,
    steerSens: 1,
    touch: "auto",
    difficulty: "normal",
  },
  championship: null,
  trackMastery: {},
  carMastery: {},
  career: emptyCareer(),
  challenges: {},
};

function cleanId(id: unknown, allowed: readonly string[], fallback: string): string {
  return typeof id === "string" && allowed.includes(id) ? id : fallback;
}

function cleanList(value: unknown, allowed: readonly string[]): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const id of value) {
    if (typeof id === "string" && allowed.includes(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

function cleanCup(value: unknown): ActiveChampionship | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<ActiveChampionship>;
  const def = typeof row.id === "string" ? cupById(row.id) : undefined;
  if (!def) return null;
  const vehicleIds = VEHICLES.map((car) => car.id);
  const difficulty: AiDifficulty =
    row.difficulty === "easy" || row.difficulty === "hard" || row.difficulty === "normal" ? row.difficulty : "normal";
  const vehicleId = cleanId(row.vehicleId, vehicleIds, "vector");
  const results: CupRoundResult[] = [];
  if (Array.isArray(row.results)) {
    for (const item of row.results) {
      if (!item || typeof item !== "object") continue;
      const round = item as Partial<CupRoundResult>;
      const expected = def.rounds[results.length];
      if (!expected || round.trackId !== expected.trackId) break;
      const finishers = Array.isArray(round.finishers)
        ? round.finishers
            .filter((finisher) => finisher && typeof finisher === "object" && typeof finisher.id === "string")
            .map((finisher) => ({
              id: finisher.id,
              name: typeof finisher.name === "string" ? finisher.name : finisher.id,
              place: typeof finisher.place === "number" ? finisher.place : 0,
              time: typeof finisher.time === "number" && finisher.time > 0 ? finisher.time : null,
              bestLap: typeof finisher.bestLap === "number" && finisher.bestLap > 0 ? finisher.bestLap : null,
            }))
        : [];
      results.push({ round: results.length, trackId: expected.trackId, title: expected.title, finishers });
      if (results.length >= def.rounds.length) break;
    }
  }
  const complete = results.length >= def.rounds.length;
  return {
    id: def.id,
    vehicleId,
    difficulty,
    round: results.length,
    results,
    complete,
  };
}

function cleanMedal(value: unknown): Medal | "none" {
  return value === "bronze" || value === "silver" || value === "gold" ? value : "none";
}

function cleanTrackMastery(value: unknown): TrackMastery {
  const row = value && typeof value === "object" ? (value as Partial<TrackMastery>) : {};
  return {
    races: typeof row.races === "number" && row.races > 0 ? Math.floor(row.races) : 0,
    wins: typeof row.wins === "number" && row.wins > 0 ? Math.floor(row.wins) : 0,
    podiums: typeof row.podiums === "number" && row.podiums > 0 ? Math.floor(row.podiums) : 0,
    bestPlace: typeof row.bestPlace === "number" && row.bestPlace > 0 ? Math.floor(row.bestPlace) : null,
    distance: typeof row.distance === "number" && row.distance > 0 ? row.distance : 0,
    medal: cleanMedal(row.medal),
  };
}

function cleanCarMastery(value: unknown): CarMastery {
  const row = value && typeof value === "object" ? (value as Partial<CarMastery>) : {};
  const trackIds = new Set(TRACKS.map((track) => track.id));
  const won = Array.isArray(row.tracksWon) ? row.tracksWon.filter((id) => typeof id === "string" && trackIds.has(id)) : [];
  return {
    races: typeof row.races === "number" && row.races > 0 ? Math.floor(row.races) : 0,
    wins: typeof row.wins === "number" && row.wins > 0 ? Math.floor(row.wins) : 0,
    podiums: typeof row.podiums === "number" && row.podiums > 0 ? Math.floor(row.podiums) : 0,
    bestPlace: typeof row.bestPlace === "number" && row.bestPlace > 0 ? Math.floor(row.bestPlace) : null,
    bestRace: typeof row.bestRace === "number" && row.bestRace > 0 ? row.bestRace : null,
    bestLap: typeof row.bestLap === "number" && row.bestLap > 0 ? row.bestLap : null,
    distance: typeof row.distance === "number" && row.distance > 0 ? row.distance : 0,
    tracksWon: [...new Set(won)],
    championships: typeof row.championships === "number" && row.championships > 0 ? Math.floor(row.championships) : 0,
  };
}

function cleanCareer(value: unknown): CareerStats {
  const row = value && typeof value === "object" ? (value as Partial<CareerStats>) : {};
  const cups = new Set(["neon-cup", "neon-cup-2"]);
  const list = (input: unknown) => (Array.isArray(input) ? [...new Set(input.filter((id) => typeof id === "string" && cups.has(id)))] : []);
  return {
    races: typeof row.races === "number" && row.races > 0 ? Math.floor(row.races) : 0,
    wins: typeof row.wins === "number" && row.wins > 0 ? Math.floor(row.wins) : 0,
    podiums: typeof row.podiums === "number" && row.podiums > 0 ? Math.floor(row.podiums) : 0,
    distance: typeof row.distance === "number" && row.distance > 0 ? row.distance : 0,
    pbCount: typeof row.pbCount === "number" && row.pbCount > 0 ? Math.floor(row.pbCount) : 0,
    golds: typeof row.golds === "number" && row.golds > 0 ? Math.floor(row.golds) : 0,
    silvers: typeof row.silvers === "number" && row.silvers > 0 ? Math.floor(row.silvers) : 0,
    bronzes: typeof row.bronzes === "number" && row.bronzes > 0 ? Math.floor(row.bronzes) : 0,
    cupsCompleted: list(row.cupsCompleted),
    cupsWon: list(row.cupsWon),
    cupPodiums: list(row.cupPodiums),
  };
}

function cleanChallenges(value: unknown): Record<string, ChallengeProgress> {
  const row = value && typeof value === "object" ? (value as Record<string, Partial<ChallengeProgress>>) : {};
  const out: Record<string, ChallengeProgress> = {};
  for (const [id, item] of Object.entries(row)) {
    if (!item || typeof item !== "object") continue;
    const current = typeof item.current === "number" && item.current > 0 ? item.current : 0;
    const completedAt = typeof item.completedAt === "number" && item.completedAt >= 0 ? item.completedAt : null;
    if (current > 0 || completedAt != null) out[id] = { current, completedAt };
  }
  return out;
}

function cleanMasteryMaps(tracksIn: unknown, carsIn: unknown): { trackMastery: Record<string, TrackMastery>; carMastery: Record<string, CarMastery> } {
  const tracks = tracksIn && typeof tracksIn === "object" ? (tracksIn as Record<string, unknown>) : {};
  const cars = carsIn && typeof carsIn === "object" ? (carsIn as Record<string, unknown>) : {};
  const trackMastery: Record<string, TrackMastery> = {};
  const carMastery: Record<string, CarMastery> = {};
  for (const track of TRACKS) trackMastery[track.id] = cleanTrackMastery(tracks[track.id]);
  for (const car of VEHICLES) carMastery[car.id] = cleanCarMastery(cars[car.id]);
  return { trackMastery, carMastery };
}

function cleanRecord(value: unknown): TrackRecord {
  const row = value && typeof value === "object" ? (value as Partial<TrackRecord>) : {};
  const car = (id: unknown) => (typeof id === "string" && VEHICLES.some((item) => item.id === id) ? id : null);
  const bestSectors = Array.from({ length: 4 }, (_, index) => {
    const value = Array.isArray(row.bestSectors) ? row.bestSectors[index] : undefined;
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
  });
  return {
    bestLap: typeof row.bestLap === "number" && row.bestLap > 0 ? row.bestLap : null,
    bestRace: typeof row.bestRace === "number" && row.bestRace > 0 ? row.bestRace : null,
    bestSectors,
    bestLapCar: car(row.bestLapCar),
    bestRaceCar: car(row.bestRaceCar),
    bestAvg: typeof row.bestAvg === "number" && row.bestAvg > 0 ? row.bestAvg : null,
    bestAvgCar: car(row.bestAvgCar),
  };
}

function cleanSettings(value: unknown, fallback: SaveSettings): SaveSettings {
  const row = value && typeof value === "object" ? (value as Partial<SaveSettings>) : {};
  const quality: Quality = row.quality === "low" || row.quality === "high" || row.quality === "medium" ? row.quality : fallback.quality;
  const touch: TouchMode = row.touch === "on" || row.touch === "off" || row.touch === "auto" ? row.touch : fallback.touch;
  const difficulty: AiDifficulty =
    row.difficulty === "easy" || row.difficulty === "hard" || row.difficulty === "normal" ? row.difficulty : fallback.difficulty;
  return {
    quality,
    volume: typeof row.volume === "number" ? Math.min(1, Math.max(0, row.volume)) : fallback.volume,
    steerSens: typeof row.steerSens === "number" ? Math.min(1.4, Math.max(0.6, row.steerSens)) : fallback.steerSens,
    touch,
    difficulty,
  };
}

function withStarters(data: SaveData): SaveData {
  const vehicles = new Set(data.unlockedVehicles);
  const tracks = new Set(data.unlockedTracks);
  for (const car of VEHICLES) if (car.startsUnlocked) vehicles.add(car.id);
  for (const track of TRACKS) if (track.startsUnlocked) tracks.add(track.id);
  const vehicleIds = new Set(VEHICLES.map((car) => car.id));
  const trackIds = new Set(TRACKS.map((track) => track.id));
  const selectedVehicle = vehicleIds.has(data.selectedVehicle) ? data.selectedVehicle : "vector";
  const selectedTrack = trackIds.has(data.selectedTrack) ? data.selectedTrack : "apex";
  return {
    ...data,
    saveVersion: SAVE_VERSION,
    unlockedVehicles: [...vehicles],
    unlockedTracks: [...tracks],
    selectedVehicle,
    selectedTrack,
  };
}

function finishSave(data: SaveData): SaveData {
  const next = withStarters(data);
  proveCareer(next);
  syncChallenges(next, 0);
  return next;
}

function blankSave(): SaveData {
  const maps = cleanMasteryMaps(null, null);
  return finishSave({
    ...defaultSave,
    unlockedVehicles: [...defaultSave.unlockedVehicles],
    unlockedTracks: [...defaultSave.unlockedTracks],
    trackRecords: {},
    trackMastery: maps.trackMastery,
    carMastery: maps.carMastery,
    career: emptyCareer(),
    challenges: {},
    championship: null,
  });
}

function fromLegacy(raw: LegacyV1): SaveData {
  const maps = cleanMasteryMaps(null, null);
  const next: SaveData = {
    ...defaultSave,
    unlockedVehicles: [...defaultSave.unlockedVehicles],
    unlockedTracks: [...defaultSave.unlockedTracks],
    trackRecords: {},
    trackMastery: maps.trackMastery,
    carMastery: maps.carMastery,
    career: emptyCareer(),
    challenges: {},
    settings: cleanSettings(raw, defaultSave.settings),
    championship: null,
  };
  if (typeof raw.bestLap === "number" || typeof raw.bestTime === "number") {
    next.trackRecords.apex = cleanRecord({
      bestLap: typeof raw.bestLap === "number" ? raw.bestLap : null,
      bestRace: typeof raw.bestTime === "number" ? raw.bestTime : null,
    });
  }
  return finishSave(next);
}

export function normalizeSave(parsed: Partial<SaveData> | LegacyV1 | null | undefined): SaveData {
  if (!parsed || typeof parsed !== "object") return blankSave();
  if ("version" in parsed && parsed.version === 1 && !("saveVersion" in parsed)) return fromLegacy(parsed as LegacyV1);
  const data = parsed as Partial<SaveData>;
  const vehicleIds = VEHICLES.map((car) => car.id);
  const trackIds = TRACKS.map((track) => track.id);
  const recordsIn = data.trackRecords && typeof data.trackRecords === "object" ? data.trackRecords : {};
  const trackRecords: Record<string, TrackRecord> = {};
  for (const id of trackIds) {
    if (id in recordsIn) trackRecords[id] = cleanRecord(recordsIn[id as keyof typeof recordsIn]);
  }
  const maps = cleanMasteryMaps(data.trackMastery, data.carMastery);
  return finishSave({
    saveVersion: SAVE_VERSION,
    unlockedVehicles: cleanList(data.unlockedVehicles, vehicleIds),
    unlockedTracks: cleanList(data.unlockedTracks, trackIds),
    selectedVehicle: cleanId(data.selectedVehicle, vehicleIds, "vector"),
    selectedTrack: cleanId(data.selectedTrack, trackIds, "apex"),
    trackRecords,
    settings: cleanSettings(data.settings, defaultSave.settings),
    championship: cleanCup(data.championship),
    trackMastery: maps.trackMastery,
    carMastery: maps.carMastery,
    career: cleanCareer(data.career),
    challenges: cleanChallenges(data.challenges),
  });
}

export function loadSave(): SaveData {
  try {
    const current = localStorage.getItem(KEY);
    if (current) return normalizeSave(JSON.parse(current) as Partial<SaveData>);
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const migrated = normalizeSave(JSON.parse(legacy) as LegacyV1);
      writeSave(migrated);
      return migrated;
    }
    return blankSave();
  } catch {
    return blankSave();
  }
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...data, saveVersion: SAVE_VERSION }));
  } catch {
    /* private mode */
  }
}

export function isVehicleUnlocked(id: string, data: SaveData, unlockAll = false): boolean {
  if (unlockAll) return VEHICLES.some((car) => car.id === id);
  return vehicleById(id).startsUnlocked || data.unlockedVehicles.includes(id);
}

export function isTrackUnlocked(id: string, data: SaveData, unlockAll = false): boolean {
  if (unlockAll) return TRACKS.some((track) => track.id === id);
  return trackById(id).startsUnlocked || data.unlockedTracks.includes(id);
}

export type FinishCommit = {
  save: SaveData;
  newLap: boolean;
  newRace: boolean;
  freshUnlock: string | null;
};

/** Records a finish and grants whatever that track definition unlocks. */
export function commitFinish(
  data: SaveData,
  trackId: string,
  raceTime: number,
  bestLap: number | null,
  sectorTimes: readonly number[] = [],
): FinishCommit {
  const save = normalizeSave(data);
  const prev = save.trackRecords[trackId] ?? cleanRecord(null);
  const next: TrackRecord = { ...prev, bestSectors: [...prev.bestSectors] };
  const newLap = bestLap != null && bestLap > 0 && (prev.bestLap == null || bestLap < prev.bestLap);
  const finished = raceTime > 0;
  const newRace = finished && (prev.bestRace == null || raceTime < prev.bestRace);
  if (newLap && bestLap != null) next.bestLap = bestLap;
  if (newRace) next.bestRace = raceTime;
  for (let index = 0; index < next.bestSectors.length; index++) {
    const time = sectorTimes[index];
    if (typeof time === "number" && time > 0 && (next.bestSectors[index] === 0 || time < next.bestSectors[index]!)) {
      next.bestSectors[index] = time;
    }
  }
  if (
    next.bestLap != null ||
    next.bestRace != null ||
    next.bestAvg != null ||
    next.bestSectors.some((time) => time > 0) ||
    save.trackRecords[trackId]
  ) {
    save.trackRecords = { ...save.trackRecords, [trackId]: next };
  }
  let freshUnlock: string | null = null;
  if (finished) {
    const unlocked = new Set(save.unlockedTracks);
    for (const id of trackById(trackId).unlocks) {
      if (!unlocked.has(id) && !trackById(id).startsUnlocked) {
        unlocked.add(id);
        freshUnlock = trackById(id).name;
      }
    }
    save.unlockedTracks = [...unlocked];
  }
  return { save: withStarters(save), newLap, newRace, freshUnlock };
}
