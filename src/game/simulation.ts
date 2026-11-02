import { aiCommand } from "./ai";
import { checkGate, rankCars, respawnCar, sectorProgress, separateCars } from "./race";
import { projectInto, sampleAt, buildPad, buildTrack, buildCourse, type Projection, type Track } from "./track";
import { AI_CARS, RACE, type AiDifficulty } from "./tuning";
import { VECTOR, vehicleById } from "./vehicle-def";
import type { CarState, CourseId, InputCommand, Phase } from "./types";
import { IDLE_INPUT } from "./types";
import { applyLaunch, stepCar } from "./vehicle";

const SECTOR_COUNT = 4;

/** Gate indices that close a phone-readable four-sector split. */
function completedSectorForGate(gateIndex: number, gateCount: number): number {
  if (gateCount <= 0) return -1;
  const completed = (gateIndex + 1) * SECTOR_COUNT;
  if (completed % gateCount !== 0) return -1;
  return Math.min(SECTOR_COUNT - 1, completed / gateCount - 1);
}

const scratch: Projection = {
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

export type Sim = {
  track: Track;
  pad: Track;
  mode: CourseId;
  cars: CarState[];
  phase: Phase;
  countdown: number;
  raceTime: number;
  totalLaps: number;
  finishCount: number;
  finishingTime: number;
  falseStart: boolean;
  /** Test only. The player is driven by the same AI command path. */
  debugAutoPlayer: boolean;
  difficulty: AiDifficulty;
  qa: boolean;
  banner: string;
  bannerTime: number;
  wrongTime: number;
};

export function courseOf(sim: Sim): Track {
  return sim.mode === "pad" ? sim.pad : sim.track;
}

function blankCar(id: string, name: string, color: number, isPlayer: boolean, aiIndex: number, vehicleId: string): CarState {
  return {
    id,
    name,
    vehicleId,
    color,
    isPlayer,
    ai: isPlayer ? null : AI_CARS[aiIndex]!,
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    yawRate: 0,
    vx: 0,
    vz: 0,
    vy: 0,
    airborne: false,
    wasJump: false,
    boostEnergy: 1,
    boostLock: 0,
    boostTime: 0,
    boostBlend: 0,
    drifting: false,
    driftCharge: 0,
    driftState: 0,
    slipAngle: 0,
    frontUse: 0,
    rearUse: 0,
    frontLoad: 0.5,
    rearLoad: 0.5,
    liftBlend: 0,
    gripBlend: 1,
    gear: 0,
    rpm: 0.18,
    shiftLock: 0,
    shifts: 0,
    longAccel: 0,
    latAccel: 0,
    latVel: 0,
    longSlip: 0,
    latSlip: 0,
    longUse: 0,
    latUse: 0,
    wheelspin: 0,
    bodyPitch: 0,
    bodyRoll: 0,
    laps: 0,
    nextGate: 0,
    sector: 0,
    sectorIndex: 0,
    sectorClock: 0,
    sectorTimes: [],
    bestSectorTimes: [],
    lapClock: 0,
    lastLap: 0,
    bestLap: 0,
    arc: 0,
    raceDist: 0,
    arcReady: true,
    finished: false,
    finishTime: 0,
    finishPlace: 0,
    stuck: 0,
    forwardSpeed: 0,
    slip: 0,
    latOff: 0,
    roadHalf: 8,
    crashPulse: 0,
    steerVisual: 0,
    throttleVisual: 0,
    brakeVisual: 0,
    boosting: false,
    aiSteer: 0,
    aiState: "grid",
    aiTarget: 0,
    aiBrakeDist: 0,
    aiLineError: 0,
    aiNode: 0,
    lane: 0,
    travel: 0,
    nitroUses: 0,
    hint: -1,
    wheelSpin: 0,
    kerbL: 0,
    kerbR: 0,
    respawnArc: 0,
    prevX: 0,
    prevZ: 0,
    spawnX: 0,
    spawnY: 0,
    spawnZ: 0,
    spawnYaw: 0,
    spawnArc: 0,
  };
}

export function createSim(qa: boolean): Sim {
  const track = buildTrack();
  const cars = [
    blankCar("you", VECTOR.name, VECTOR.color, true, 0, VECTOR.id),
    blankCar("vex", "VEX", AI_CARS[0]!.color, false, 0, AI_CARS[0]!.vehicleId),
    blankCar("ion", "ION", AI_CARS[1]!.color, false, 1, AI_CARS[1]!.vehicleId),
    blankCar("nyx", "NYX", AI_CARS[2]!.color, false, 2, AI_CARS[2]!.vehicleId),
  ];
  const sim: Sim = {
    track,
    pad: buildPad(),
    mode: "race",
    cars,
    phase: "menu",
    countdown: 0,
    raceTime: 0,
    totalLaps: track.laps,
    finishCount: 0,
    finishingTime: 0,
    falseStart: false,
    debugAutoPlayer: false,
    difficulty: "normal",
    qa,
    banner: "",
    bannerTime: 0,
    wrongTime: 0,
  };
  placeGrid(sim);
  return sim;
}

/** Point every car at one definition. Rivals keep their names, liveries, and driving profiles. */
export function applyLineup(sim: Sim, playerVehicleId: string): void {
  const player = vehicleById(playerVehicleId);
  const you = sim.cars[0];
  if (you) {
    you.vehicleId = player.id;
    you.name = player.name;
    you.color = player.color;
  }
  for (let i = 0; i < AI_CARS.length; i++) {
    const car = sim.cars[i + 1];
    const ai = AI_CARS[i];
    if (!car || !ai) continue;
    car.vehicleId = ai.vehicleId;
    car.name = ai.name;
    car.color = ai.color;
  }
}

export function loadCourse(sim: Sim, trackId: string): void {
  sim.track = buildCourse(trackId);
  sim.totalLaps = sim.track.laps;
}

export function placeGrid(sim: Sim): void {
  const track = courseOf(sim);
  const slots = [
    { row: 0, col: 0 },
    { row: 0, col: 1 },
    { row: 1, col: 0 },
    { row: 1, col: 1 },
  ];
  sim.cars.forEach((car, i) => {
    if (sim.mode === "pad" && !car.isPlayer) {
      car.x = 8000 + i * 20;
      car.z = 8000;
      car.y = -40;
      car.vx = 0;
      car.vz = 0;
      car.forwardSpeed = 0;
      return;
    }
    const slot = slots[i]!;
    const grid = track.grid;
    const arc = track.length - grid.holdBack - slot.row * grid.rowGap;
    const lat = sim.mode === "pad" ? 0 : slot.col === 0 ? -grid.lat : grid.lat;
    const s = sampleAt(track, arc);
    car.x = s.x + s.rx * lat;
    car.z = s.z + s.rz * lat;
    car.y = s.y;
    car.yaw = Math.atan2(-s.tx, -s.tz);
    car.vy = 0;
    car.airborne = false;
    car.wasJump = false;
    car.boostEnergy = 1;
    car.boostLock = 0;
    car.boostTime = 0;
    car.driftCharge = 0;
    car.laps = 0;
    car.nextGate = 0;
    car.sector = 0;
    car.sectorIndex = 0;
    car.sectorClock = 0;
    car.sectorTimes = [];
    car.bestSectorTimes = [];
    car.lapClock = 0;
    car.lastLap = 0;
    car.bestLap = 0;
    car.arc = arc;
    car.raceDist = arc;
    car.arcReady = true;
    car.finished = false;
    car.finishTime = 0;
    car.finishPlace = 0;
    car.stuck = 0;
    car.crashPulse = 0;
    car.kerbL = 0;
    car.kerbR = 0;
    car.steerVisual = 0;
    car.throttleVisual = 0;
    car.brakeVisual = 0;
    car.boosting = false;
    car.aiSteer = 0;
    car.aiState = "grid";
    car.aiTarget = 0;
    car.aiBrakeDist = 0;
    car.aiLineError = 0;
    car.aiNode = 0;
    car.lane = slot.col === 0 ? -0.75 : 0.75;
    if (slot.row === 1) car.lane *= 1.5;
    car.travel = 0;
    car.nitroUses = 0;
    car.hint = -1;
    car.latOff = lat;
    car.respawnArc = arc;
    car.spawnX = car.x;
    car.spawnY = car.y;
    car.spawnZ = car.z;
    car.spawnYaw = car.yaw;
    car.spawnArc = arc;
    applyLaunch(car, 0);
    car.prevX = car.x;
    car.prevZ = car.z;
    projectInto(track, car.x, car.z, -1, scratch);
    car.hint = scratch.sampleIndex;
    car.y = scratch.y;
    car.spawnY = car.y;
  });
  sim.finishCount = 0;
  sim.finishingTime = 0;
  sim.falseStart = false;
  sim.raceTime = 0;
  sim.banner = "";
  sim.bannerTime = 0;
  sim.wrongTime = 0;
}

export function startCountdown(sim: Sim): void {
  placeGrid(sim);
  sim.phase = "grid";
  sim.countdown = sim.qa ? RACE.qaGridHold : RACE.gridHold;
}

function pinGrid(sim: Sim, playerInput: InputCommand): void {
  if ((playerInput.throttle > 0.2 || playerInput.boost) && (sim.phase === "countdown" || sim.phase === "grid")) {
    sim.falseStart = true;
  }
  for (const car of sim.cars) {
    car.x = car.spawnX;
    car.y = car.spawnY;
    car.z = car.spawnZ;
    car.yaw = car.spawnYaw;
    car.yawRate = 0;
    car.vx = 0;
    car.vz = 0;
    car.vy = 0;
    car.forwardSpeed = 0;
    car.prevX = car.x;
    car.prevZ = car.z;
    car.throttleVisual = car.isPlayer ? playerInput.throttle : 0;
    car.brakeVisual = car.isPlayer ? playerInput.brake : 0;
    car.aiState = "grid";
  }
}

export function awardFinish(sim: Sim, car: CarState): void {
  if (car.finished || sim.mode === "pad") return;
  car.finished = true;
  car.finishTime = sim.raceTime;
  sim.finishCount += 1;
  car.finishPlace = sim.finishCount;
  if (car.isPlayer && sim.phase === "racing") {
    sim.phase = "finishing";
    sim.finishingTime = 0;
    sim.banner = "FINISH";
    sim.bannerTime = RACE.finishGrace;
  }
}

function closeField(sim: Sim): void {
  const pending = rankCars(sim.cars.filter((car) => !car.finished));
  for (const car of pending) {
    sim.finishCount += 1;
    car.finishPlace = sim.finishCount;
    car.finished = true;
    car.finishTime = -1;
  }
  sim.phase = "results";
  sim.banner = "";
  sim.bannerTime = 0;
}

export function stepSim(sim: Sim, dt: number, playerInput: InputCommand, steerSens: number): void {
  if (sim.bannerTime > 0) sim.bannerTime = Math.max(0, sim.bannerTime - dt);
  if (sim.bannerTime <= 0 && sim.banner === "FINAL LAP") sim.banner = "";

  if (sim.phase === "menu" || sim.phase === "results") return;

  if (sim.phase === "grid" || sim.phase === "countdown") {
    pinGrid(sim, playerInput);
    sim.countdown -= dt;
    if (sim.countdown > 0) return;
    if (sim.phase === "grid") {
      sim.phase = "countdown";
      sim.countdown = sim.qa ? RACE.qaCountdown : RACE.countdown;
      return;
    }
    sim.phase = "racing";
    sim.raceTime = 0;
    for (const car of sim.cars) car.lapClock = 0;
    return;
  }

  const live = sim.phase === "racing" || sim.phase === "finishing";
  if (!live) return;
  if (sim.phase === "finishing") sim.finishingTime += dt;
  sim.raceTime += dt;
  const track = courseOf(sim);
  for (const car of sim.cars) {
    if (sim.mode === "pad" && !car.isPlayer) continue;
    const wasBoost = car.boosting;
    const input =
      car.isPlayer && !sim.debugAutoPlayer
        ? playerInput
        : aiCommand(car, track, dt, sim.cars, sim.difficulty, sim.raceTime);
    if (car.finished) {
      input.throttle = Math.min(input.throttle, 0.35);
      input.boost = false;
      input.drift = false;
      input.brake = Math.max(input.brake, 0.15);
    }
    car.prevX = car.x;
    car.prevZ = car.z;
    stepCar(car, input, track, dt, steerSens);
    if (car.boosting && !wasBoost) car.nitroUses += 1;
    if (!car.finished) car.travel += Math.max(0, car.forwardSpeed) * dt;
    if (!car.finished && sim.mode !== "pad") {
      car.lapClock += dt;
      car.sectorClock += dt;
      car.sector = sectorProgress(car, track);
      const passedGate = car.nextGate;
      const hit = checkGate(car, track);
      if (hit === "gate" || hit === "lap") {
        const completedSector = completedSectorForGate(passedGate, track.gates.length);
        if (completedSector >= 0 && car.sectorClock > 0) {
          car.sectorTimes[completedSector] = car.sectorClock;
          const best = car.bestSectorTimes[completedSector] ?? 0;
          if (best <= 0 || car.sectorClock < best) car.bestSectorTimes[completedSector] = car.sectorClock;
          car.sectorClock = 0;
          car.sectorIndex = (completedSector + 1) % SECTOR_COUNT;
        }
      }
      if (hit === "lap") {
        car.lastLap = car.lapClock;
        if (car.bestLap <= 0 || car.lapClock < car.bestLap) car.bestLap = car.lapClock;
        car.lapClock = 0;
        car.laps += 1;
        car.sector = 0;
        if (car.isPlayer && car.laps === sim.totalLaps - 1) {
          sim.banner = "FINAL LAP";
          sim.bannerTime = RACE.finalBanner;
        }
        if (car.laps >= sim.totalLaps) awardFinish(sim, car);
      }
    }
    const crawling = car.forwardSpeed < 3.2 && (car.isPlayer ? playerInput.throttle > 0.5 || sim.debugAutoPlayer : true);
    if (crawling && !car.airborne && sim.mode !== "pad" && !car.finished) car.stuck += dt;
    else car.stuck = Math.max(0, car.stuck - dt);
    if (sim.mode !== "pad" && !car.finished && (car.stuck > 3.4 || Math.abs(car.latOff) > car.roadHalf + 14)) {
      respawnCar(car, track);
    }
  }
  if (sim.mode !== "pad") separateCars(sim.cars);

  const player = sim.cars[0]!;
  if (player.forwardSpeed < -7) sim.wrongTime = 0.6;
  else sim.wrongTime = Math.max(0, sim.wrongTime - dt);

  if (sim.phase === "finishing") {
    const allDone = sim.cars.every((car) => car.finished);
    if (allDone || sim.finishingTime >= RACE.finishGrace) closeField(sim);
  }
}

export function playerCar(sim: Sim): CarState {
  return sim.cars[0]!;
}

export function ordered(sim: Sim): CarState[] {
  return rankCars(sim.cars);
}

export function countdownLabel(sim: Sim): string {
  if (sim.phase === "grid") return "GRID";
  if (sim.phase !== "countdown") return "";
  const total = sim.qa ? RACE.qaCountdown : RACE.countdown;
  const elapsed = total - sim.countdown;
  if (sim.qa) return "GO";
  if (elapsed < 1) return "3";
  if (elapsed < 2) return "2";
  if (elapsed < 3) return "1";
  return "GO";
}

export { IDLE_INPUT };
