import * as THREE from "three";
import { AudioDirector } from "./audio";
import { attachInput, gamepadPausePressed, readCommand, setTestKeys } from "./input";
import { clamp, wrapAngle } from "./math";
import { timeGapSeconds } from "./race";
import {
  applyLineup,
  countdownLabel,
  courseOf,
  createSim,
  loadCourse,
  ordered,
  placeGrid,
  playerCar,
  startCountdown,
  stepSim,
  type Sim,
} from "./simulation";
import { useGame, type GapRow, type ResultRow } from "./store";
import { PRESENT } from "./tuning";
import type { CarState } from "./types";
import { driftStateLabel } from "./vehicle";
import { buildScene, disposeBundle, drawMinimap, syncCar, type CarPaint, type CarVis } from "./visuals";
import { buildEnvironment, type BuiltEnvironment } from "./environment";
import { themeFor } from "./track-def";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

const STEP = 1 / 60;

function copyPose(into: CarVis, car: CarState): void {
  into.x = car.x;
  into.y = car.y;
  into.z = car.z;
  into.yaw = car.yaw;
  into.pitch = car.bodyPitch;
  into.roll = car.bodyRoll;
  into.spin = car.wheelSpin;
  into.steer = car.steerVisual;
}

function blendPose(out: CarVis, prev: CarVis, car: CarState, t: number): void {
  const dx = car.x - prev.x;
  const dz = car.z - prev.z;
  if (dx * dx + dz * dz > 36) {
    copyPose(prev, car);
    copyPose(out, car);
    return;
  }
  out.x = prev.x + dx * t;
  out.y = prev.y + (car.y - prev.y) * t;
  out.z = prev.z + dz * t;
  out.yaw = prev.yaw + wrapAngle(car.yaw - prev.yaw) * t;
  out.pitch = prev.pitch + (car.bodyPitch - prev.pitch) * t;
  out.roll = prev.roll + (car.bodyRoll - prev.roll) * t;
  out.spin = prev.spin + (car.wheelSpin - prev.spin) * t;
  out.steer = prev.steer + (car.steerVisual - prev.steer) * t;
}

function paintsOf(sim: Sim): CarPaint[] {
  return sim.cars.map((car) => ({
    color: car.color,
    id: car.vehicleId,
    rival: !car.isPlayer,
  }));
}

function contactPan(player: CarState, cars: readonly CarState[]): number {
  const rx = Math.cos(player.yaw);
  const rz = -Math.sin(player.yaw);
  let best = 14;
  let pan = clamp(player.latOff / 6, -1, 1);
  for (const car of cars) {
    if (car === player) continue;
    const dx = car.x - player.x;
    const dz = car.z - player.z;
    const dist = Math.hypot(dx, dz);
    if (dist < best) {
      best = dist;
      pan = clamp((dx * rx + dz * rz) / 4.5, -1, 1);
    }
  }
  return pan;
}

function focusRival(sim: Sim): CarState | undefined {
  const player = sim.cars[0];
  if (!player) return undefined;
  const length = courseOf(sim).length;
  let best: CarState | undefined;
  let bestD = 1e9;
  for (const car of sim.cars) {
    if (car.isPlayer) continue;
    let delta = car.arc - player.arc;
    if (delta > length * 0.5) delta -= length;
    if (delta < -length * 0.5) delta += length;
    if (delta > 0 && delta < bestD) {
      bestD = delta;
      best = car;
    }
  }
  return best ?? sim.cars[1];
}

function rankedResults(rank: readonly CarState[]): ResultRow[] {
  let fastest = 0;
  for (const car of rank) {
    if (car.bestLap > 0 && (fastest === 0 || car.bestLap < fastest)) fastest = car.bestLap;
  }
  return rank.map((car, i) => ({
    name: car.name,
    place: car.finishPlace > 0 ? car.finishPlace : i + 1,
    time: car.finishTime > 0 ? car.finishTime : null,
    color: `#${car.color.toString(16).padStart(6, "0")}`,
    isPlayer: car.isPlayer,
    avg: car.finishTime > 0 ? (car.travel / car.finishTime) * 3.6 : null,
    nitro: car.nitroUses,
    bestLap: car.bestLap > 0 ? car.bestLap : null,
    fastest: fastest > 0 && car.bestLap === fastest,
    id: car.id,
  }));
}

export function startGame(canvas: HTMLCanvasElement, minimap: HTMLCanvasElement | null): () => void {
  const params = new URLSearchParams(window.location.search);
  const qa = import.meta.env.DEV && params.get("qa") === "1";
  const sim = createSim(qa);
  let raceBundle = buildScene(sim.track, paintsOf(sim));
  let padBundle = buildScene(sim.pad, paintsOf(sim));
  let bundle = raceBundle;
  let shownKey = `${sim.track.id}:${sim.cars[0]!.vehicleId}`;
  const audio = new AudioDirector();

  let renderer: THREE.WebGLRenderer;
  /** Dev-only QA camera: park the view on one car and optionally hold time. */
  let inspect: InspectSpec | null = null;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  } catch {
    window.dispatchEvent(new CustomEvent("game-fallback", { detail: "WebGL context could not be created." }));
    return () => {};
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = false;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    window.dispatchEvent(new CustomEvent("game-fallback", { detail: "WebGL context lost." }));
  });
  // Reflections come from a theme-matched night environment rather than a
  // white studio, so paint keeps its colour under clearcoat reflections.
  let raceEnv: BuiltEnvironment = buildEnvironment(renderer, themeFor(sim.track.themeId));
  const padEnv: BuiltEnvironment = buildEnvironment(renderer, themeFor(sim.pad.themeId));
  const bindEnv = (scene: THREE.Scene) => {
    scene.environment = scene === padBundle.scene ? padEnv.texture : raceEnv.texture;
  };
  const rebuildRaceEnv = () => {
    raceEnv.dispose();
    raceEnv = buildEnvironment(renderer, themeFor(sim.track.themeId));
    raceBundle.scene.environment = raceEnv.texture;
  };
  bindEnv(raceBundle.scene);
  bindEnv(padBundle.scene);
  const camera = new THREE.PerspectiveCamera(62, 1, 0.2, 2800);
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(bundle.scene, camera);
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.48, 0.52, 0.78);
  composer.addPass(renderPass);
  composer.addPass(bloomPass);

  const applyQuality = () => {
    const q = useGame.getState().quality;
    const cap = q === "low" ? 0.75 : q === "high" ? 1.5 : 1.1;
    // Shadows are the single biggest cost per frame: off on Low, a 1024 map
    // on Medium, 2048 on High. Cars are the only casters, so the map is small
    // and always in motion around the player.
    renderer.shadowMap.enabled = q !== "low";
    renderer.shadowMap.type = q === "high" ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    const wantSize = q === "high" ? 2048 : 1024;
    for (const scene of [raceBundle.scene, padBundle.scene]) {
      const sun = scene.userData.sun as THREE.DirectionalLight | undefined;
      if (!sun) continue;
      sun.castShadow = q !== "low";
      if (sun.shadow.mapSize.x !== wantSize) {
        sun.shadow.mapSize.set(wantSize, wantSize);
        sun.shadow.map?.dispose();
        sun.shadow.map = null;
      }
    }
    renderer.setPixelRatio(Math.min(cap, window.devicePixelRatio || 1));
    const w = canvas.clientWidth || window.innerWidth || 1;
    const h = canvas.clientHeight || window.innerHeight || 1;
    renderer.setSize(w, h, false);
    composer.setPixelRatio(Math.min(cap, window.devicePixelRatio || 1));
    composer.setSize(w, h);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    const fog = bundle.scene.fog as THREE.FogExp2;
    const baseFog = typeof bundle.scene.userData.fogDensity === "number" ? bundle.scene.userData.fogDensity : 0.0042;
    if (fog) fog.density = q === "low" ? baseFog * 1.4 : q === "high" ? baseFog * 0.72 : baseFog;
    bundle.scene.environmentIntensity = q === "low" ? 0.45 : q === "high" ? 1.05 : 0.78;
    // Keep the bloom cinematic rather than bleaching the neon city. Mobile
    // screens are already bright, so medium quality stays deliberately soft.
    renderer.toneMappingExposure = q === "low" ? 1.05 : q === "high" ? 1.18 : 1.1;
    // Medium is the phone-safe baseline. Only the explicit High setting pays
    // for a bloom pass; low and medium stay on the direct renderer path.
    bloomPass.enabled = q === "high";
    bloomPass.strength = 0.24;
    bloomPass.radius = 0.5;
    bloomPass.threshold = 1.02;
    bundle.dressing.visible = q !== "low";
    const lamp = q === "low" ? 0 : q === "high" ? 6.2 : 3.3;
    for (const view of bundle.cars) {
      view.headLight.intensity = lamp;
      view.headLight.visible = lamp > 0;
    }
  };

  if (import.meta.env.DEV) {
    window.__controlsTest = {
      getYaw: () => playerCar(sim).yaw,
      getSpeed: () => playerCar(sim).forwardSpeed,
      setKeys: (codes: string[]) => setTestKeys(codes),
      setInspect: (spec) => {
        inspect = spec;
      },
      clearInspect: () => {
        inspect = null;
      },
      carCount: () => sim.cars.length,
      phase: () => sim.phase,
    };
  }

  const detachKeys = attachInput();
  const unlock = () => audio.unlock();
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);

  let seenStart = 0;
  let seenRestart = 0;
  let seenMenu = 0;
  let acc = 0;
  let hudAcc = 0;
  let orbit = 0;
  let impactCooldown = 0;
  let crashArmed = 0;
  let lastLabel = "";
  let camX = sim.cars[0]!.x;
  let camY = sim.cars[0]!.y + 6;
  let camZ = sim.cars[0]!.z + 14;
  let lookX = sim.cars[0]!.x;
  let lookY = sim.cars[0]!.y + 1;
  let lookZ = sim.cars[0]!.z;
  let shake = 0;
  let raf = 0;
  let dead = false;
  let lastQuality: "low" | "medium" | "high" = useGame.getState().quality;
  const clock = new THREE.Timer();
  clock.connect(document);
  const fwd = new THREE.Vector3();
  const gapShown: Record<string, number> = {};
  const lastPulse = sim.cars.map(() => 0);
  const skidAt = sim.cars.map(() => ({ x: 0, z: 1e9 }));
  const prevPose: CarVis[] = sim.cars.map((car) => ({
    x: car.x,
    y: car.y,
    z: car.z,
    yaw: car.yaw,
    pitch: car.bodyPitch,
    roll: car.bodyRoll,
    spin: car.wheelSpin,
    steer: car.steerVisual,
  }));
  const shown: CarVis[] = prevPose.map((pose) => ({ ...pose }));

  const reduced =
    typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const gapList = (rank: readonly CarState[]): GapRow[] => {
    let best = 1e9;
    let closeId = "";
    const rows = rank
      .filter((car) => !car.isPlayer)
      .map((car) => {
        const seconds = gapShown[car.id] ?? 0;
        const abs = Math.abs(seconds);
        if (abs < best) {
          best = abs;
          closeId = car.id;
        }
        return {
          name: car.name,
          color: `#${car.color.toString(16).padStart(6, "0")}`,
          seconds,
          close: false,
          id: car.id,
        };
      });
    return rows.map(({ id, ...row }) => ({ ...row, close: id === closeId }));
  };

  const pushHud = (force = false) => {
    const player = playerCar(sim);
    const rank = ordered(sim);
    const place = rank.findIndex((c) => c.isPlayer) + 1;
    const displayLap = Math.min(sim.totalLaps, player.finished ? player.laps : player.laps + 1);
    const showTime = player.finished && player.finishTime > 0 ? player.finishTime : sim.raceTime;
    const slide = clamp(Math.abs(player.slipAngle) / 0.42, 0, 1);
    const rival = focusRival(sim);
    const record = useGame.getState().records[sim.track.id];
    const sectorIndex = Math.max(0, Math.min(3, player.sectorIndex));
    const sectorBest = record?.bestSectors?.[sectorIndex] ?? 0;
    useGame.setState({
      phase: sim.phase,
      speed: Math.abs(player.forwardSpeed) * 3.6,
      lap: Math.max(1, displayLap),
      laps: sim.totalLaps,
      position: place || 1,
      racers: sim.mode === "pad" ? 1 : sim.cars.length,
      boost: player.boostEnergy,
      drift: slide,
      drifting: player.drifting || player.driftState === 2,
      gear: player.gear + 1,
      rpm: player.rpm,
      countdownLabel: countdownLabel(sim),
      banner: sim.phase === "finishing" ? "FINISH" : sim.bannerTime > 0 ? sim.banner : "",
      wrongWay: sim.wrongTime > 0 && (sim.phase === "racing" || sim.phase === "finishing"),
      raceTime: showTime,
      lapTime: player.finished ? player.lastLap : player.lapClock,
      bestLap: player.bestLap > 0 ? player.bestLap : null,
      sectorIndex,
      sectorTime: player.sectorClock,
      sectorBest: sectorBest > 0 ? sectorBest : null,
      sectorDelta: sectorBest > 0 ? player.sectorClock - sectorBest : null,
      gaps: sim.mode === "pad" ? [] : gapList(rank),
      telemetry: {
        speed: Math.abs(player.forwardSpeed) * 3.6,
        accel: player.longAccel,
        throttle: player.throttleVisual,
        brake: player.brakeVisual,
        steer: player.steerVisual,
        gear: player.gear + 1,
        rpm: player.rpm,
        longVel: player.forwardSpeed,
        latVel: player.latVel,
        longSlip: player.longSlip,
        latSlip: player.latSlip,
        slipAngle: player.slipAngle,
        frontUse: player.frontUse,
        rearUse: player.rearUse,
        frontLoad: player.frontLoad,
        rearLoad: player.rearLoad,
        yawRate: player.yawRate,
        driftState: driftStateLabel(player.driftState),
        raceState: sim.phase,
        lap: Math.max(1, displayLap),
        checkpoint: player.nextGate,
        position: place || 1,
        aiState: rival?.aiState ?? "",
        aiName: rival?.name ?? "",
        aiSpeed: rival ? Math.abs(rival.forwardSpeed) * 3.6 : 0,
        aiTarget: rival ? rival.aiTarget * 3.6 : 0,
        aiBrakeDist: rival?.aiBrakeDist ?? 0,
        aiThrottle: rival?.throttleVisual ?? 0,
        aiBrake: rival?.brakeVisual ?? 0,
        aiSteer: rival?.aiSteer ?? 0,
        aiNode: rival?.aiNode ?? 0,
        aiLineError: rival?.aiLineError ?? 0,
        aiSlip: rival ? (rival.slipAngle * 180) / Math.PI : 0,
        aiFront: rival?.frontUse ?? 0,
        aiRear: rival?.rearUse ?? 0,
        aiNitro: rival?.boosting ?? false,
        falseStart: sim.falseStart,
        longUse: player.longUse,
        latUse: player.latUse,
        drift: player.drifting,
        boost: player.boosting,
        wheelspin: player.wheelspin,
      },
      results: force || sim.phase === "results" ? rankedResults(rank) : useGame.getState().results,
    });
  };

  let postedResults = false;
  const finishIfNeeded = () => {
    if (sim.phase !== "results") {
      postedResults = false;
      return;
    }
    if (postedResults || sim.mode === "pad") return;
    postedResults = true;
    const player = playerCar(sim);
    const lap = player.bestLap > 0 ? player.bestLap : null;
    useGame.getState().commitRace(
      sim.track.id,
      player.finishTime,
      lap,
      sim.cars.map((car) => ({
        id: car.id,
        name: car.name,
        place: car.finishPlace > 0 ? car.finishPlace : 0,
        time: car.finishTime > 0 ? car.finishTime : null,
        bestLap: car.bestLap > 0 ? car.bestLap : null,
      })),
      {
        vehicleId: player.vehicleId,
        place: player.finishPlace,
        distance: player.travel,
        avg: player.finishTime > 0 ? (player.travel / player.finishTime) * 3.6 : null,
        sectorTimes: player.bestSectorTimes,
      },
    );
    audio.finish();
  };

  const onResize = () => applyQuality();
  window.addEventListener("resize", onResize);
  const ro = new ResizeObserver(() => applyQuality());
  ro.observe(canvas);

  const syncSelection = (trackId: string, vehicleId: string) => {
    const key = `${trackId}:${vehicleId}`;
    if (key === shownKey) return;
    loadCourse(sim, trackId);
    applyLineup(sim, vehicleId);
    disposeBundle(raceBundle);
    raceBundle = buildScene(sim.track, paintsOf(sim));
    disposeBundle(padBundle);
    padBundle = buildScene(sim.pad, paintsOf(sim));
    bundle = sim.mode === "pad" ? padBundle : raceBundle;
    renderPass.scene = bundle.scene;
    shownKey = key;
    rebuildRaceEnv();
    bindEnv(raceBundle.scene);
    bindEnv(padBundle.scene);
    if (sim.phase === "menu") {
      placeGrid(sim);
      sim.phase = "menu";
      sim.countdown = 0;
    }
    applyQuality();
  };

  const loop = (stamp: number) => {
    if (dead) return;
    raf = requestAnimationFrame(loop);
    clock.update(stamp);
    const frameDt = Math.min(0.05, clock.getDelta());
    const now = clock.getElapsed();
    acc += frameDt;
    let steps = 0;

    const store = useGame.getState();
    // Gamepad Start/Options toggles pause during a race (edge-triggered so a
    // held button only toggles once).
    if (
      gamepadPausePressed() &&
      (sim.phase === "grid" || sim.phase === "countdown" || sim.phase === "racing" || sim.phase === "finishing")
    ) {
      useGame.getState().togglePaused();
    }
    if (store.quality !== lastQuality) {
      lastQuality = store.quality;
      applyQuality();
    }
    sim.difficulty = store.raceContext?.difficulty ?? store.difficulty;
    if (sim.phase === "menu") syncSelection(store.selectedTrack, store.selectedVehicle);
    if (store.startNonce !== seenStart) {
      seenStart = store.startNonce;
      sim.mode = store.course;
      const ctx = store.raceContext;
      if (store.course === "race") syncSelection(ctx?.trackId ?? store.selectedTrack, ctx?.vehicleId ?? store.selectedVehicle);
      else applyLineup(sim, store.selectedVehicle);
      bundle = sim.mode === "pad" ? padBundle : raceBundle;
      renderPass.scene = bundle.scene;
      audio.unlock();
      startCountdown(sim);
      lastLabel = "";
      applyQuality();
    }
    if (store.restartNonce !== seenRestart) {
      seenRestart = store.restartNonce;
      bundle = sim.mode === "pad" ? padBundle : raceBundle;
      audio.unlock();
      startCountdown(sim);
      lastLabel = "";
    }
    if (store.menuNonce !== seenMenu) {
      seenMenu = store.menuNonce;
      sim.mode = "race";
      sim.phase = "menu";
      syncSelection(store.selectedTrack, store.selectedVehicle);
      placeGrid(sim);
      sim.phase = "menu";
      sim.countdown = 0;
      bundle = raceBundle;
      renderPass.scene = bundle.scene;
    }

    let hitPeak = 0;
    // Freeze physics and race timers while paused: skip the step loop
    // entirely so stepSim (which advances sim.raceTime, lapClock, etc.)
    // is never called. Rendering continues so the frozen frame stays on
    // screen behind the pause overlay.
    const frozen = inspect !== null && inspect.freeze !== false;
    while (!store.paused && !frozen && acc >= STEP && steps < 5) {
      for (let i = 0; i < sim.cars.length; i++) {
        const pose = prevPose[i];
        const car = sim.cars[i];
        if (pose && car) copyPose(pose, car);
      }
      const racingInput = readCommand();
      const active =
        sim.phase === "racing" || sim.phase === "countdown"
          ? racingInput
          : { ...racingInput, throttle: 0, brake: 0, steer: 0, boost: false, drift: false };
      stepSim(sim, STEP, active, store.steerSens);
      const pulseNow = sim.cars[0]?.crashPulse ?? 0;
      if (pulseNow > hitPeak) hitPeak = pulseNow;
      acc -= STEP;
      steps++;
    }
    if (steps === 5) acc = 0;
    const alpha = steps >= 5 ? 1 : acc / STEP;
    for (let i = 0; i < sim.cars.length; i++) {
      const pose = prevPose[i];
      const car = sim.cars[i];
      const out = shown[i];
      if (pose && car && out) blendPose(out, pose, car, alpha);
    }

    const label = countdownLabel(sim);
    if (label && label !== lastLabel && sim.phase === "countdown") {
      audio.unlock();
      if (label === "GO") audio.beep(880, 0.18, 0.08);
      else audio.beep(520 + Number(label) * 40, 0.12, 0.06);
      lastLabel = label;
    }

    finishIfNeeded();

    const player = playerCar(sim);
    if (sim.mode === "race") {
      for (const car of sim.cars) {
        if (car.isPlayer) continue;
        const raw = timeGapSeconds(player, car);
        const prev = gapShown[car.id] ?? raw;
        gapShown[car.id] = prev + (raw - prev) * (1 - Math.exp(-frameDt / 0.32));
      }
    }
    if (!store.paused) {
      audio.setVolume(store.volume);
      audio.update({
        rpm: player.rpm,
        throttle: player.throttleVisual,
        brake: player.brakeVisual,
        drift: player.driftState >= 2,
        slip: player.slip,
        slipAngle: Math.abs(player.slipAngle),
        boosting: player.boosting,
        shifts: player.shifts,
        gear: player.gear,
        speed: Math.abs(player.forwardSpeed),
        driftState: player.driftState,
        track: sim.mode === "pad" ? "apex" : sim.track.id,
        vehicle: player.vehicleId,
      });
    }
    impactCooldown = Math.max(0, impactCooldown - frameDt);
    if (hitPeak > 0.05 && hitPeak > crashArmed + 0.04 && impactCooldown <= 0) {
      audio.impact(hitPeak, contactPan(player, sim.cars));
      if (!reduced) shake = Math.max(shake, hitPeak > 0.4 ? hitPeak * 0.4 : hitPeak * 0.08);
      impactCooldown = hitPeak > 0.62 ? 0.22 : hitPeak > 0.28 ? 0.12 : 0.08;
    }
    crashArmed = player.crashPulse;
    if (player.boosting && !reduced) shake = Math.max(shake, 0.035);

    const q = store.quality;
    bundle.dressing.visible = q !== "low";
    const lamp = q === "low" ? 0 : q === "high" ? 6.2 : 3.3;
    for (let i = 0; i < sim.cars.length; i++) {
      const car = sim.cars[i]!;
      const view = bundle.cars[i];
      if (!view) continue;
      view.headLight.intensity = lamp;
      view.headLight.visible = lamp > 0;
      const vis = shown[i];
      const pitch = car.airborne ? clamp(car.vy / 30, -0.35, 0.45) : 0;
      syncCar(view, car, pitch, vis);
      const slide = Math.max(Math.abs(car.latVel), Math.abs(car.slipAngle) * 16);
      const vx = vis?.x ?? car.x;
      const vy = vis?.y ?? car.y;
      const vz = vis?.z ?? car.z;
      const vyaw = vis?.yaw ?? car.yaw;
      if (slide > 2.6 && (sim.phase === "racing" || sim.phase === "finishing")) {
        const rx = Math.cos(vyaw);
        const rz = -Math.sin(vyaw);
        if (slide > 9) bundle.sparks.spawn(vx - rx * 0.9, vy, vz - rz * 0.9, -car.vx, -car.vz);
        if (q !== "low") {
          const last = skidAt[i];
          if (last && Math.hypot(vx - last.x, vz - last.z) > 1.2) {
            last.x = vx;
            last.z = vz;
            const sfx = -Math.sin(vyaw);
            const sfz = -Math.cos(vyaw);
            const leftX = vx - sfx * 1.2 - rx * 0.82;
            const leftZ = vz - sfz * 1.2 - rz * 0.82;
            const rightX = vx - sfx * 1.2 + rx * 0.82;
            const rightZ = vz - sfz * 1.2 + rz * 0.82;
            bundle.skids.drop(leftX, vy, leftZ, vyaw);
            bundle.skids.drop(rightX, vy, rightZ, vyaw);
            bundle.smoke.puff(leftX, vy, leftZ, -car.vx, -car.vz);
            bundle.smoke.puff(rightX, vy, rightZ, -car.vx, -car.vz);
          }
        }
      }
      const prevHit = lastPulse[i] ?? 0;
      if (car.crashPulse > 0.34 && car.crashPulse > prevHit + 0.08) {
        bundle.flashes.burst(vx, vy, vz, car.crashPulse);
        bundle.sparks.spawn(vx, vy + 0.4, vz, -car.vx * 0.15, -car.vz * 0.15);
      }
      lastPulse[i] = car.crashPulse;
    }
    bundle.sparks.update(frameDt);
    bundle.smoke.update(frameDt);
    bundle.flashes.update(frameDt);

    const view = shown[0];
    const px = view?.x ?? player.x;
    const py = view?.y ?? player.y;
    const pz = view?.z ?? player.z;
    const pyaw = view?.yaw ?? player.yaw;
    const fx = -Math.sin(pyaw);
    const fz = -Math.cos(pyaw);
    const speed = Math.abs(player.forwardSpeed);
    let desiredX: number;
    let desiredY: number;
    let desiredZ: number;
    let targetLookX: number;
    let targetLookY: number;
    let targetLookZ: number;
    let fov = 58;

    if (sim.phase === "menu") {
      orbit += frameDt * (reduced ? 0 : 0.22);
      desiredX = px + Math.sin(orbit) * 16;
      desiredZ = pz + Math.cos(orbit) * 16;
      desiredY = py + 5.2;
      targetLookX = px;
      targetLookY = py + 1;
      targetLookZ = pz;
    } else {
      const accelN = clamp(player.longAccel / 12, -1, 1);
      const latN = clamp(player.latAccel / 14, -1, 1);
      const boostN = player.boostBlend;
      const slideN = clamp(Math.abs(player.slipAngle) / 0.4, 0, 1);
      const brakeN = clamp(player.brakeVisual, 0, 1);
      const dist =
        7.4 +
        Math.min(4.2, speed * 0.04) +
        accelN * PRESENT.camAccelPull +
        boostN * PRESENT.camBoostPull +
        slideN * 0.45;
      const height = 2.55 + Math.min(1.3, speed * 0.018) - brakeN * 0.1;
      const rx = Math.cos(pyaw);
      const rz = -Math.sin(pyaw);
      desiredX = px - fx * dist + rx * latN * 0.42;
      desiredZ = pz - fz * dist + rz * latN * 0.42;
      desiredY = py + height;
      const ahead = 6.5 + Math.min(10, speed * 0.18);
      targetLookX = px + fx * ahead + rx * latN * 0.7;
      targetLookY = py + 1.15 - brakeN * 0.2 + Math.max(0, accelN) * 0.05;
      targetLookZ = pz + fz * ahead + rz * latN * 0.7;
      fov =
        60 +
        Math.min(8, speed * 0.11) +
        accelN * PRESENT.camAccelFov +
        boostN * (PRESENT.camBoostFov + 1.2) +
        slideN * 1.1;
      if (!reduced) {
        shake = Math.max(shake, Math.abs(accelN) * PRESENT.camAccelShake + boostN * PRESENT.camBoostShake + slideN * 0.01);
      }
    }

    const k = 1 - Math.exp(-frameDt * (sim.phase === "menu" ? 2.2 : 4.4));
    camX += (desiredX - camX) * k;
    camY += (desiredY - camY) * k;
    camZ += (desiredZ - camZ) * k;
    lookX += (targetLookX - lookX) * k;
    lookY += (targetLookY - lookY) * k;
    lookZ += (targetLookZ - lookZ) * k;
    shake *= Math.exp(-frameDt * 6);

    if (inspect) {
      // QA camera: hold a fixed orbit around one car (dev harness only).
      const idx = clamp(Math.trunc(inspect.car ?? 0), 0, sim.cars.length - 1);
      const pose = shown[idx] ?? shown[0]!;
      const a = pose.yaw + (inspect.angle ?? Math.PI);
      const d = inspect.dist ?? 9;
      camera.up.set(0, 1, 0);
      camera.position.set(pose.x - Math.sin(a) * d, pose.y + (inspect.height ?? 2.2), pose.z - Math.cos(a) * d);
      camera.lookAt(pose.x, pose.y + (inspect.look ?? 0.55), pose.z);
      const wantFov = inspect.fov ?? 46;
      if (Math.abs(camera.fov - wantFov) > 0.05) {
        camera.fov = wantFov;
        camera.updateProjectionMatrix();
      }
    } else {
    camera.position.set(camX + Math.sin(now * 23) * shake, camY + Math.cos(now * 19) * shake * 0.55, camZ);
    const tilt =
      sim.phase === "menu" || reduced ? 0 : player.steerVisual * -0.02 + clamp(player.latAccel / 14, -1, 1) * -0.08;
    fwd.set(fx, 0, fz);
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    camera.up.set(0, 1, 0);
    camera.up.applyAxisAngle(fwd.normalize(), tilt);
    camera.lookAt(lookX, lookY, lookZ);
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov += (fov - camera.fov) * Math.min(1, frameDt * 4);
      camera.updateProjectionMatrix();
    }
    }

    // Keep the shadow camera tight around the player so one 1024/2048 map
    // covers the car and the tarmac it sits on.
    const sun = bundle.scene.userData.sun as THREE.DirectionalLight | undefined;
    if (sun && sun.castShadow) {
      const focus = shown[0] ?? player;
      sun.position.set(focus.x + 60, focus.y + 92, focus.z + 22);
      sun.target.position.set(focus.x, focus.y, focus.z);
      sun.target.updateMatrixWorld();
    }

    renderPass.scene = bundle.scene;
    if (q !== "high") renderer.render(bundle.scene, camera);
    else composer.render();

    hudAcc += frameDt;
    if (hudAcc > 0.05) {
      hudAcc = 0;
      pushHud(false);
    }
    if (minimap) {
      const ctx = minimap.getContext("2d");
      if (ctx) drawMinimap(ctx, courseOf(sim), sim.cars, minimap.width, minimap.height, shown);
    }
  };

  applyQuality();
  pushHud(true);
  raf = requestAnimationFrame(loop);

  return () => {
    dead = true;
    cancelAnimationFrame(raf);
    setTestKeys([]);
    if (import.meta.env.DEV) {
      delete window.__controlsTest;
    }
    detachKeys();
    clock.disconnect();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
    window.removeEventListener("resize", onResize);
    ro.disconnect();
    disposeBundle(raceBundle);
    disposeBundle(padBundle);
    raceEnv.dispose();
    padEnv.dispose();
    composer.dispose();
    renderer.dispose();
  };
}
