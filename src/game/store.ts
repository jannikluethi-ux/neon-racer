import { create } from "zustand";
import { createCup, currentRound, earnedUnlocks, playerStanding, recordRound, restartCup, roundsOf, type ActiveChampionship, type CupFinisher } from "./championship";
import { dailyEvent } from "./daily";
import { applyProgress, emptyCareer, type CarMastery, type CareerStats, type ChallengeProgress, type RaceSummary, type TrackMastery } from "./mastery";
import type { SaveData, Quality, TouchMode, AiDifficulty, TrackRecord } from "./save";
import { commitFinish, defaultSave, isTrackUnlocked, isVehicleUnlocked, SAVE_VERSION, writeSave } from "./save";
import { trackById } from "./track-def";
import { vehicleById } from "./vehicle-def";
import type { CourseId, Phase } from "./types";

export type MenuScreen = "title" | "cars" | "tracks" | "settings" | "profile" | "cup" | "cup-diff" | "cup-brief";
export type MenuFlow = "browse" | "race" | "cup";
export type PersonalBest = "lap" | "race" | "both" | null;
export type ConfirmKind = "quit" | "replace" | null;

export type RaceContext = {
  trackId: string;
  vehicleId: string;
  difficulty: AiDifficulty;
  cup: boolean;
  daily?: boolean;
};

export type GapRow = {
  name: string;
  color: string;
  seconds: number;
  close: boolean;
};

export type RaceExtras = {
  vehicleId: string;
  place: number;
  distance: number;
  avg: number | null;
  sectorTimes?: number[];
};

export type SectorReview = {
  times: number[];
  best: number[];
  deltas: Array<number | null>;
  biggestLoss: { index: number; seconds: number } | null;
};

export type ResultRow = {
  name: string;
  place: number;
  time: number | null;
  color: string;
  isPlayer: boolean;
  avg: number | null;
  nitro: number;
  bestLap: number | null;
  fastest: boolean;
  id: string;
};

export type Telemetry = {
  speed: number;
  accel: number;
  throttle: number;
  brake: number;
  steer: number;
  gear: number;
  rpm: number;
  longVel: number;
  latVel: number;
  longSlip: number;
  latSlip: number;
  slipAngle: number;
  frontUse: number;
  rearUse: number;
  frontLoad: number;
  rearLoad: number;
  yawRate: number;
  driftState: string;
  raceState: string;
  lap: number;
  checkpoint: number;
  position: number;
  aiState: string;
  aiName: string;
  aiSpeed: number;
  aiTarget: number;
  aiBrakeDist: number;
  aiThrottle: number;
  aiBrake: number;
  aiSteer: number;
  aiNode: number;
  aiLineError: number;
  aiSlip: number;
  aiFront: number;
  aiRear: number;
  aiNitro: boolean;
  falseStart: boolean;
  longUse: number;
  latUse: number;
  drift: boolean;
  boost: boolean;
  wheelspin: number;
};

const EMPTY_TEL: Telemetry = {
  speed: 0,
  accel: 0,
  throttle: 0,
  brake: 0,
  steer: 0,
  gear: 1,
  rpm: 0.2,
  longVel: 0,
  latVel: 0,
  longSlip: 0,
  latSlip: 0,
  slipAngle: 0,
  frontUse: 0,
  rearUse: 0,
  frontLoad: 0.5,
  rearLoad: 0.5,
  yawRate: 0,
  driftState: "GRIP",
  raceState: "menu",
  lap: 1,
  checkpoint: 0,
  position: 1,
  aiState: "grid",
  aiName: "",
  aiSpeed: 0,
  aiTarget: 0,
  aiBrakeDist: 0,
  aiThrottle: 0,
  aiBrake: 0,
  aiSteer: 0,
  aiNode: 0,
  aiLineError: 0,
  aiSlip: 0,
  aiFront: 0,
  aiRear: 0,
  aiNitro: false,
  falseStart: false,
  longUse: 0,
  latUse: 0,
  drift: false,
  boost: false,
  wheelspin: 0,
};

type GameState = {
  phase: Phase;
  course: CourseId;
  speed: number;
  lap: number;
  laps: number;
  position: number;
  racers: number;
  boost: number;
  drift: number;
  drifting: boolean;
  gear: number;
  rpm: number;
  countdownLabel: string;
  banner: string;
  wrongWay: boolean;
  raceTime: number;
  lapTime: number;
  bestLap: number | null;
  sectorIndex: number;
  sectorTime: number;
  sectorBest: number | null;
  sectorDelta: number | null;
  results: ResultRow[];
  gaps: GapRow[];
  quality: Quality;
  volume: number;
  steerSens: number;
  touch: TouchMode;
  difficulty: AiDifficulty;
  screen: MenuScreen;
  flow: MenuFlow;
  selectedVehicle: string;
  selectedTrack: string;
  unlockedVehicles: string[];
  unlockedTracks: string[];
  records: Record<string, TrackRecord>;
  trackMastery: Record<string, TrackMastery>;
  carMastery: Record<string, CarMastery>;
  career: CareerStats;
  challenges: Record<string, ChallengeProgress>;
  lastProgress: RaceSummary | null;
  sectorReview: SectorReview | null;
  personalBest: PersonalBest;
  freshUnlock: string | null;
  settingsOpen: boolean;
  telemetry: Telemetry;
  startNonce: number;
  restartNonce: number;
  menuNonce: number;
  requestStart: () => void;
  requestPad: () => void;
  requestRestart: () => void;
  requestMenu: (screen?: MenuScreen) => void;
  openScreen: (screen: MenuScreen, flow?: MenuFlow) => void;
  selectVehicle: (id: string) => void;
  selectTrack: (id: string) => void;
  beginRace: () => void;
  beginDailyRace: () => void;
  commitRace: (trackId: string, raceTime: number, bestLap: number | null, finishers?: CupFinisher[], extras?: RaceExtras) => void;
  setSettingsOpen: (open: boolean) => void;
  patchSettings: (partial: Partial<Pick<SaveData["settings"], "quality" | "volume" | "steerSens" | "touch" | "difficulty">>) => void;
  hydrate: (data: SaveData) => void;
  /** Dev preview only. Does not write unlocks into the save. */
  unlockAll: boolean;
  setUnlockAll: (on: boolean) => void;
  cup: ActiveChampionship | null;
  /** Which championship a new cup will start. Not written as an unlock. */
  cupPick: string;
  pickCup: (id: string) => void;
  raceContext: RaceContext | null;
  confirm: ConfirmKind;
  beginCupRound: () => void;
  abandonCup: () => void;
  replaceCup: () => void;
  restartChampionship: () => void;
  askConfirm: (kind: ConfirmKind) => void;
};

function snapshot(s: GameState): SaveData {
  return {
    saveVersion: SAVE_VERSION,
    unlockedVehicles: s.unlockedVehicles,
    unlockedTracks: s.unlockedTracks,
    selectedVehicle: s.selectedVehicle,
    selectedTrack: s.selectedTrack,
    trackRecords: s.records,
    trackMastery: s.trackMastery,
    carMastery: s.carMastery,
    career: s.career,
    challenges: s.challenges,
    settings: {
      quality: s.quality,
      volume: s.volume,
      steerSens: s.steerSens,
      touch: s.touch,
      difficulty: s.difficulty,
    },
    championship: s.cup,
  };
}

function applySave(data: SaveData) {
  return {
    quality: data.settings.quality,
    volume: data.settings.volume,
    steerSens: data.settings.steerSens,
    touch: data.settings.touch,
    difficulty: data.settings.difficulty,
    selectedVehicle: data.selectedVehicle,
    selectedTrack: data.selectedTrack,
    unlockedVehicles: data.unlockedVehicles,
    unlockedTracks: data.unlockedTracks,
    records: data.trackRecords,
    trackMastery: data.trackMastery,
    carMastery: data.carMastery,
    career: data.career,
    challenges: data.challenges,
    bestLap: data.trackRecords[data.selectedTrack]?.bestLap ?? null,
  };
}
export const useGame = create<GameState>((set, get) => ({
  phase: "menu",
  course: "race",
  speed: 0,
  lap: 1,
  laps: 3,
  position: 1,
  racers: 4,
  boost: 1,
  drift: 0,
  drifting: false,
  gear: 1,
  rpm: 0.2,
  countdownLabel: "",
  banner: "",
  wrongWay: false,
  raceTime: 0,
  lapTime: 0,
  bestLap: null,
  sectorIndex: 0,
  sectorTime: 0,
  sectorBest: null,
  sectorDelta: null,
  results: [],
  gaps: [],
  quality: defaultSave.settings.quality,
  volume: defaultSave.settings.volume,
  steerSens: defaultSave.settings.steerSens,
  touch: defaultSave.settings.touch,
  difficulty: defaultSave.settings.difficulty,
  screen: "title",
  flow: "browse",
  selectedVehicle: defaultSave.selectedVehicle,
  selectedTrack: defaultSave.selectedTrack,
  unlockedVehicles: [...defaultSave.unlockedVehicles],
  unlockedTracks: [...defaultSave.unlockedTracks],
  records: {},
  trackMastery: {},
  carMastery: {},
  career: emptyCareer(),
  challenges: {},
  lastProgress: null,
  sectorReview: null,
  personalBest: null,
  freshUnlock: null,
  settingsOpen: false,
  telemetry: EMPTY_TEL,
  startNonce: 0,
  restartNonce: 0,
  menuNonce: 0,
  unlockAll: import.meta.env.DEV,
  setUnlockAll: (unlockAll) => set({ unlockAll }),
  cup: null,
  cupPick: "neon-cup",
  raceContext: null,
  confirm: null,
  requestStart: () => set((s) => ({ startNonce: s.startNonce + 1, settingsOpen: false, course: "race", screen: "title" })),
  requestPad: () => set((s) => ({ startNonce: s.startNonce + 1, settingsOpen: false, course: "pad", screen: "title" })),
  requestRestart: () => set((s) => ({ restartNonce: s.restartNonce + 1 })),
  requestMenu: (screen = "title") =>
    set((s) => ({
      menuNonce: s.menuNonce + 1,
      settingsOpen: false,
      screen,
      flow: screen === "title" ? "browse" : s.flow,
      raceContext: null,
      confirm: null,
    })),
  openScreen: (screen, flow) => set((s) => ({ screen, flow: flow ?? s.flow, settingsOpen: screen === "settings" })),
  selectVehicle: (id) => {
    const s = get();
    if (!isVehicleUnlocked(id, snapshot(s), s.unlockAll)) return;
    set({ selectedVehicle: id });
    writeSave(snapshot(get()));
  },
  selectTrack: (id) => {
    const s = get();
    if (!isTrackUnlocked(id, snapshot(s), s.unlockAll)) return;
    set({ selectedTrack: id });
    writeSave(snapshot(get()));
  },
  beginRace: () => {
    const s = get();
    if (!isTrackUnlocked(s.selectedTrack, snapshot(s), s.unlockAll)) return;
    if (!isVehicleUnlocked(s.selectedVehicle, snapshot(s), s.unlockAll)) return;
    set({ startNonce: s.startNonce + 1, course: "race", screen: "title", settingsOpen: false, personalBest: null, freshUnlock: null, lastProgress: null, sectorReview: null, raceContext: null });
  },
  beginDailyRace: () => {
    const s = get();
    const event = dailyEvent();
    set({
      startNonce: s.startNonce + 1,
      course: "race",
      screen: "title",
      settingsOpen: false,
      personalBest: null,
      freshUnlock: null,
      lastProgress: null,
      sectorReview: null,
      raceContext: { trackId: event.trackId, vehicleId: event.vehicleId, difficulty: s.difficulty, cup: false, daily: true },
    });
  },
  commitRace: (trackId, raceTime, bestLap, finishers?: CupFinisher[], extras?: RaceExtras) => {
    const before = snapshot(get());
    const previousLap = before.trackRecords[trackId]?.bestLap ?? null;
    const previousRace = before.trackRecords[trackId]?.bestRace ?? null;
    const previousSectors = before.trackRecords[trackId]?.bestSectors ?? [];
    const currentSectors = extras?.sectorTimes?.map((time) => (typeof time === "number" && time > 0 ? time : 0)) ?? [];
    const sectorDeltas = currentSectors.map((time, index) => {
      const previous = previousSectors[index] ?? 0;
      return previous > 0 ? time - previous : null;
    });
    const biggestLoss = sectorDeltas.reduce<{ index: number; seconds: number } | null>((best, delta, index) => {
      if (delta == null || delta <= 0 || (best != null && delta <= best.seconds)) return best;
      return { index, seconds: delta };
    }, null);
    const result = commitFinish(before, trackId, raceTime, bestLap, extras?.sectorTimes);
    const personalBest: PersonalBest = result.newLap && result.newRace ? "both" : result.newLap ? "lap" : result.newRace ? "race" : null;
    const prior = get().cup;
    const wasComplete = prior?.complete ?? false;
    let cup = prior;
    const ctx = get().raceContext;
    const names: string[] = [];
    if (result.freshUnlock) names.push(result.freshUnlock);
    if (ctx?.cup && cup && finishers && finishers.length > 0) {
      const round = roundsOf(cup)[cup.round];
      if (round && round.trackId === trackId) {
        cup = recordRound(cup, { round: cup.round, trackId, title: round.title, finishers });
      }
    }
    if (cup?.complete) {
      const reward = earnedUnlocks(cup);
      const tracks = new Set(result.save.unlockedTracks);
      const vehicles = new Set(result.save.unlockedVehicles);
      for (const id of reward.tracks) {
        if (!tracks.has(id) && !trackById(id).startsUnlocked) {
          tracks.add(id);
          names.push(trackById(id).name);
        }
      }
      for (const id of reward.vehicles) {
        if (!vehicles.has(id) && !vehicleById(id).startsUnlocked) {
          vehicles.add(id);
          names.push(vehicleById(id).name);
        }
      }
      result.save.unlockedTracks = [...tracks];
      result.save.unlockedVehicles = [...vehicles];
    }
    const justCup = cup && cup.complete && !wasComplete ? { id: cup.id, place: playerStanding(cup).place } : null;
    const summary =
      extras != null
        ? applyProgress(
            result.save,
            {
              trackId,
              vehicleId: extras.vehicleId,
              place: extras.place,
              raceTime,
              bestLap,
              avg: extras.avg,
              distance: extras.distance,
              cup: justCup,
            },
            { newLap: result.newLap, newRace: result.newRace, previousLap, previousRace },
          )
        : null;
    const save = { ...result.save, championship: cup };
    writeSave(save);
    set({
      ...applySave(save),
      cup,
      personalBest,
      freshUnlock: names.length > 0 ? names.join(" · ") : null,
      lastProgress: summary,
      sectorReview:
        currentSectors.some((time) => time > 0)
          ? {
              times: currentSectors,
              best: save.trackRecords[trackId]?.bestSectors ?? currentSectors,
              deltas: sectorDeltas,
              biggestLoss,
            }
          : null,
    });
  },
  setSettingsOpen: (settingsOpen) => set({ settingsOpen, screen: settingsOpen ? "settings" : "title" }),
  patchSettings: (partial) => {
    set(partial);
    writeSave(snapshot(get()));
  },
  hydrate: (data) => set({ ...applySave(data), cup: data.championship ?? null }),
  pickCup: (cupPick) => set({ cupPick }),
  beginCupRound: () => {
    const s = get();
    const continuing = Boolean(s.cup && !s.cup.complete);
    const cup = continuing && s.cup ? s.cup : createCup(s.selectedVehicle, s.difficulty, s.cupPick);
    const round = currentRound(cup);
    const scheduled = continuing || s.unlockAll || isTrackUnlocked(round.trackId, { ...snapshot(s), championship: cup }, false);
    if (!scheduled) return;
    writeSave({ ...snapshot(s), championship: cup });
    set({
      cup,
      raceContext: { trackId: round.trackId, vehicleId: cup.vehicleId, difficulty: cup.difficulty, cup: true },
      startNonce: s.startNonce + 1,
      course: "race",
      screen: "title",
      settingsOpen: false,
      personalBest: null,
      freshUnlock: null,
      lastProgress: null,
      sectorReview: null,
      confirm: null,
    });
  },
  abandonCup: () => {
    const s = get();
    set({ cup: null, raceContext: null, confirm: null, screen: "title", flow: "browse", menuNonce: s.menuNonce + 1 });
    writeSave(snapshot(get()));
  },
  replaceCup: () => {
    const s = get();
    set({ cup: null, raceContext: null, confirm: null, screen: "cars", flow: "cup", menuNonce: s.menuNonce + 1 });
    writeSave(snapshot(get()));
  },
  restartChampionship: () => {
    const s = get();
    if (!s.cup) return;
    const cup = restartCup(s.cup);
    set({ cup, raceContext: null, confirm: null, screen: "cup-brief", menuNonce: s.menuNonce + 1 });
    writeSave(snapshot(get()));
  },
  askConfirm: (confirm) => set({ confirm }),
}));
