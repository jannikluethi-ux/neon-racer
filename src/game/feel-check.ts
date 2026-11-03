import type { Sample, Track } from "./track";
import { IDLE_INPUT, type CarState, type InputCommand } from "./types";
import { PLAYER_COLOR } from "./tuning";
import { applyLaunch, stepCar } from "./vehicle";
import { createSim, startCountdown, stepSim } from "./simulation";

function straightTrack(): Track {
  const n = 40;
  const seg = 60;
  const samples: Sample[] = [];
  for (let i = 0; i < n; i++) {
    samples.push({
      x: i * seg,
      y: 0,
      z: 0,
      tx: 1,
      ty: 0,
      tz: 0,
      rx: 0,
      rz: 1,
      dist: i * seg,
      segLen: seg,
      width: 800,
      curv: 0,
      line: 0,
      speed: 80,
      jump: false,
    });
  }
  return {
    samples,
    gates: [],
    length: n * seg,
    minX: 0,
    maxX: n * seg,
    minZ: -30,
    maxZ: 30,
    minY: 0,
    id: "straight",
    name: "Straight",
    laps: 1,
    referenceSpeed: 80,
    grid: { holdBack: 40, rowGap: 8, lat: 0 },
    themeId: "pad",
  };
}

function car(): CarState {
  return {
    id: "you",
    name: "VECTOR",
    vehicleId: "vector",
    color: PLAYER_COLOR,
    isPlayer: true,
    ai: null,
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
    rpm: 0.2,
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
    roadHalf: 12,
    crashPulse: 0,
    steerVisual: 0,
    throttleVisual: 0,
    brakeVisual: 0,
    boosting: false,
    aiSteer: 0,
    aiState: "line",
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
    gradePitch: 0,
    gradeRoll: 0,
    wheelKerb: [0, 0, 0, 0],
    wheelNormals: [[0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0]],
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

const track = straightTrack();
const dt = 1 / 60;

function place(c: CarState) {
  const s = track.samples[2]!;
  c.x = s.x;
  c.y = s.y;
  c.z = s.z;
  c.yaw = Math.atan2(-s.tx, -s.tz);
  c.hint = -1;
  c.arc = s.dist;
  c.arcReady = true;
  applyLaunch(c, 0);
}

function run(seconds: number, input: InputCommand, step = dt, v0 = 0): CarState {
  const c = car();
  place(c);
  if (v0) applyLaunch(c, v0);
  const n = Math.round(seconds / step);
  for (let i = 0; i < n; i++) stepCar(c, input, track, step, 1);
  return c;
}

function fail(msg: string): never {
  console.error("FAIL", msg);
  process.exit(1);
}

const full = run(18, { ...IDLE_INPUT, throttle: 1 });
const kmh = full.forwardSpeed * 3.6;
if (kmh < 170 || kmh > 200) fail(`cruise ${kmh.toFixed(1)} km/h, expected ~180-190`);
if (full.gear < 4) fail(`still in gear ${full.gear + 1}`);

const early = run(0.7, { ...IDLE_INPUT, throttle: 1 });
const earlyKmh = early.forwardSpeed * 3.6;
if (earlyKmh < 22 || earlyKmh > 45) fail(`launch ${earlyKmh.toFixed(1)} km/h at 0.7s`);

const mid = run(2.1, { ...IDLE_INPUT, throttle: 1 });
if (mid.forwardSpeed * 3.6 > 110) fail(`reached ${ (mid.forwardSpeed * 3.6).toFixed(1)} by 2.1s — still too snappy`);

let v = 0;
let gearChanges = 0;
let prevGear = 0;
let maxStep = 0;
const c = car();
place(c);
for (let i = 0; i < 18 * 60; i++) {
  const before = c.forwardSpeed;
  stepCar(c, { ...IDLE_INPUT, throttle: 1 }, track, dt, 1);
  maxStep = Math.max(maxStep, c.forwardSpeed - before);
  if (c.gear !== prevGear) {
    gearChanges++;
    prevGear = c.gear;
  }
  v = c.forwardSpeed;
}
if (gearChanges < 4) fail(`only ${gearChanges} shifts`);
if (maxStep > 0.28) fail(`speed jumped ${maxStep.toFixed(3)} m/s in one tick`);
if (v * 3.6 < 170) fail(`end speed ${ (v * 3.6).toFixed(1)}`);

const coast = run(4, IDLE_INPUT, dt, 45);
if (coast.forwardSpeed > 42) fail(`coast did not slow (${coast.forwardSpeed.toFixed(1)})`);
if (coast.forwardSpeed < 18) fail(`coast died too fast (${coast.forwardSpeed.toFixed(1)})`);

let dist = 0;
{
  const b = car();
  place(b);
  applyLaunch(b, 100 / 3.6);
  const x0 = b.x;
  const z0 = b.z;
  for (let i = 0; i < 6 * 60; i++) {
    stepCar(b, { ...IDLE_INPUT, brake: 1 }, track, dt, 1);
    if (b.forwardSpeed < 0.4) break;
  }
  dist = Math.hypot(b.x - x0, b.z - z0);
}
if (dist < 18 || dist > 55) fail(`100 km/h stop distance ${dist.toFixed(1)} m`);

const low = run(1.2, { ...IDLE_INPUT, throttle: 1, steer: 1 });
const lowYaw = Math.atan2(Math.sin(low.yaw - -Math.PI / 2), Math.cos(low.yaw - -Math.PI / 2));
const high = car();
place(high);
applyLaunch(high, 42);
const yaw0 = high.yaw;
for (let i = 0; i < 30; i++) stepCar(high, { ...IDLE_INPUT, throttle: 1, steer: 1 }, track, dt, 1);
const highYaw = Math.atan2(Math.sin(high.yaw - yaw0), Math.cos(high.yaw - yaw0));
const lowRate = lowYaw / 1.2;
const highRate = highYaw / 0.5;
if (lowYaw < 0.2) fail(`low-speed A yaw ${lowYaw.toFixed(3)} not left`);
if (highYaw < 0.04) fail(`high-speed steer did not yaw (${highYaw.toFixed(3)})`);
if (highRate > lowRate * 0.8) fail(`high-speed steer not calmer (${highRate.toFixed(2)} vs ${lowRate.toFixed(2)})`);

function holdSteer(speed: number, input: InputCommand, seconds: number) {
  const c = car();
  place(c);
  applyLaunch(c, speed);
  const y0 = c.yaw;
  let peakFront = 0;
  let peakRear = 0;
  let peakLatV = 0;
  let peakYaw = 0;
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    stepCar(c, input, track, dt, 1);
    peakFront = Math.max(peakFront, Math.abs(c.frontUse));
    peakRear = Math.max(peakRear, Math.abs(c.rearUse));
    peakLatV = Math.max(peakLatV, Math.abs(c.latVel));
    peakYaw = Math.max(peakYaw, Math.abs(c.yawRate));
  }
  const dy = Math.atan2(Math.sin(c.yaw - y0), Math.cos(c.yaw - y0));
  const radiusM = c.forwardSpeed / Math.max(0.05, Math.abs(dy) / seconds);
  return {
    u: +c.forwardSpeed.toFixed(1),
    lat: +c.latVel.toFixed(2),
    peakLatV: +peakLatV.toFixed(2),
    yaw: +peakYaw.toFixed(2),
    front: +peakFront.toFixed(2),
    rear: +peakRear.toFixed(2),
    angle: +((Math.abs(c.slipAngle) * 180) / Math.PI).toFixed(1),
    radius: +radiusM.toFixed(0),
    state: c.driftState,
    ay: +c.latAccel.toFixed(2),
  };
}

const easy = holdSteer(22.2, { ...IDLE_INPUT, throttle: 0.45, steer: 0.7 }, 1.2);
const limit120 = holdSteer(33.3, { ...IDLE_INPUT, throttle: 0.55, steer: 1 }, 1.2);
const hard160 = holdSteer(44.4, { ...IDLE_INPUT, throttle: 0.7, steer: 1 }, 1.1);
const tight200 = holdSteer(55.6, { ...IDLE_INPUT, throttle: 0.85, steer: 1 }, 1.1);
const _sweep200 = holdSteer(55.6, { ...IDLE_INPUT, throttle: 0.85, steer: 0.22 }, 1.2);
const powerLow = holdSteer(32, { ...IDLE_INPUT, throttle: 0.2, steer: 0.8 }, 1.1);
const powerHigh = holdSteer(32, { ...IDLE_INPUT, throttle: 1, steer: 0.8 }, 1.1);
const brakeOff = holdSteer(36, { ...IDLE_INPUT, throttle: 0.15, steer: 0.75 }, 0.8);
const brakeOn = holdSteer(36, { ...IDLE_INPUT, throttle: 0, brake: 1, steer: 0.75 }, 0.8);
const wide200 = holdSteer(55.6, { ...IDLE_INPUT, throttle: 0.7, steer: 0.12 }, 1.2);
const calm80 = holdSteer(22.2, { ...IDLE_INPUT, throttle: 0.4, steer: 0.4 }, 1);

if (calm80.front > 0.9 || calm80.state > 1) fail(`80 km/h mild corner already over the limit (${calm80.front})`);
if (Math.abs(calm80.lat) > 2.5) fail(`80 km/h mild corner slid ${calm80.lat}`);
if (easy.radius > limit120.radius) fail(`120 km/h corner tighter than 80 (${easy.radius} vs ${limit120.radius})`);
if (limit120.front < 1.05) fail(`120 km/h full lock never reached the tire (${limit120.front})`);
if (hard160.front < 1.3 || hard160.radius < limit120.radius) {
  fail(`160 km/h still comfortable front ${hard160.front} r ${hard160.radius}`);
}
if (tight200.front < 1.5) fail(`200 km/h tight corner still planted (${tight200.front})`);
if (tight200.radius < 150) fail(`200 km/h tight radius too small ${tight200.radius}`);
if (Math.abs(tight200.lat) < 2.5) fail(`200 km/h tight corner had no slip ${tight200.lat}`);
if (wide200.front > 0.95) fail(`200 km/h sweeper exceeded the tire (${wide200.front})`);
if (wide200.state >= 3) fail("200 km/h sweeper drifted");
if (wide200.radius < tight200.radius) fail(`sweeper tighter than full lock ${wide200.radius} vs ${tight200.radius}`);
if (powerHigh.angle < powerLow.angle + 3) {
  fail(`throttle did not loosen the rear ${powerLow.angle} vs ${powerHigh.angle}`);
}
if (powerHigh.rear < powerLow.rear + 0.15) fail(`power did not load the rear tire`);
if (Math.abs(powerHigh.lat) > 14) fail(`power oversteer spun out ${powerHigh.lat}`);
if (brakeOn.angle < brakeOff.angle + 6) fail(`brake did not rotate the car ${brakeOff.angle} vs ${brakeOn.angle}`);
if (brakeOn.rear < 1) fail(`brake never unloaded the rear (${brakeOn.rear})`);
if (brakeOn.u < 8) fail(`brake spun the car to ${brakeOn.u}`);

{
  const plant = car();
  place(plant);
  applyLaunch(plant, 40);
  for (let i = 0; i < 60; i++) stepCar(plant, { ...IDLE_INPUT, throttle: 1, boost: true }, track, dt, 1);
  if (plant.drifting || Math.abs(plant.slipAngle) > 0.08) fail("boost on a straight started a drift");
}

{
  const lifted = car();
  const stayed = car();
  place(lifted);
  place(stayed);
  applyLaunch(lifted, 30);
  applyLaunch(stayed, 30);
  const enter = { ...IDLE_INPUT, throttle: 1, steer: 0.65 };
  for (let i = 0; i < 40; i++) {
    stepCar(lifted, enter, track, dt, 1);
    stepCar(stayed, enter, track, dt, 1);
  }
  const yL = lifted.yawRate;
  const yS = stayed.yawRate;
  for (let i = 0; i < 20; i++) {
    stepCar(lifted, { ...IDLE_INPUT, throttle: 0, steer: 0.65 }, track, dt, 1);
    stepCar(stayed, enter, track, dt, 1);
  }
  if (Math.abs(lifted.yawRate) < Math.abs(yL) * 0.85 && Math.abs(lifted.slipAngle) <= Math.abs(stayed.slipAngle)) {
    fail("lift-off did not rotate");
  }
  if (Math.abs(lifted.slipAngle) > 0.45) fail(`lift-off spun ${(lifted.slipAngle).toFixed(2)}`);
  if (!Number.isFinite(yS)) fail("nan");
}

const plain = run(3, { ...IDLE_INPUT, throttle: 1 }, dt, 30);
const boosted = run(3, { ...IDLE_INPUT, throttle: 1, boost: true }, dt, 30);
if (boosted.forwardSpeed < plain.forwardSpeed + 2) {
  fail(`boost ${boosted.forwardSpeed.toFixed(1)} vs plain ${plain.forwardSpeed.toFixed(1)}`);
}
const snap = car();
place(snap);
applyLaunch(snap, 30);
const s0 = snap.forwardSpeed;
stepCar(snap, { ...IDLE_INPUT, throttle: 1, boost: true }, track, dt, 1);
if (snap.forwardSpeed - s0 > 0.45) fail(`boost teleported ${(snap.forwardSpeed - s0).toFixed(3)} m/s`);

const a = run(5, { ...IDLE_INPUT, throttle: 1 }, 1 / 60);
const b = run(5, { ...IDLE_INPUT, throttle: 1 }, 1 / 120);
if (Math.abs(a.forwardSpeed - b.forwardSpeed) > 0.8) {
  fail(`framerate diverge ${a.forwardSpeed.toFixed(2)} vs ${b.forwardSpeed.toFixed(2)}`);
}
const slowFrame = run(5, { ...IDLE_INPUT, throttle: 1 }, 1 / 30);
if (Math.abs(a.forwardSpeed - slowFrame.forwardSpeed) > 1.2) {
  fail(`30Hz diverge ${slowFrame.forwardSpeed.toFixed(2)} vs ${a.forwardSpeed.toFixed(2)}`);
}

let peakSpin = 0;
let spinAtStart = 0;
let aiNote = "";
{
  const launch = car();
  place(launch);
  for (let i = 0; i < 90; i++) {
    stepCar(launch, { ...IDLE_INPUT, throttle: 1 }, track, dt, 1);
    if (i > 6 && i < 40) spinAtStart = Math.max(spinAtStart, launch.longSlip);
    peakSpin = Math.max(peakSpin, launch.wheelspin);
  }
  if (spinAtStart < 1.02) fail(`launch never slipped (${spinAtStart.toFixed(2)})`);
  if (launch.wheelspin > 0.35) fail(`still spinning in higher gears (${launch.wheelspin.toFixed(2)})`);
  if (launch.forwardSpeed < 12) fail(`launch too weak after slip (${launch.forwardSpeed.toFixed(1)})`);
}

let brakePeak = 0;
let brakeTime = 0;
{
  const bCar = car();
  place(bCar);
  applyLaunch(bCar, 100 / 3.6);
  const x0 = bCar.x;
  const z0 = bCar.z;
  for (let i = 0; i < 8 * 60; i++) {
    stepCar(bCar, { ...IDLE_INPUT, brake: 1 }, track, dt, 1);
    brakePeak = Math.max(brakePeak, -bCar.longAccel);
    brakeTime = (i + 1) / 60;
    if (bCar.forwardSpeed < 0.4) break;
  }
  const dBrake = Math.hypot(bCar.x - x0, bCar.z - z0);
  if (dBrake < 30 || dBrake > 40) fail(`brake target ${dBrake.toFixed(1)} m not in 30-40`);
  dist = dBrake;
}

{
  const nudge = car();
  place(nudge);
  applyLaunch(nudge, 22);
  const yaw = nudge.yaw;
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  nudge.vx += rx * 7;
  nudge.vz += rz * 7;
  stepCar(nudge, IDLE_INPUT, track, dt, 1);
  const before = Math.abs(nudge.latVel);
  for (let i = 0; i < 30; i++) stepCar(nudge, IDLE_INPUT, track, dt, 1);
  if (Math.abs(nudge.latVel) > before * 0.85) {
    fail(`slide not corrected ${before.toFixed(2)} -> ${nudge.latVel.toFixed(2)}`);
  }
}

const boostLow = car();
place(boostLow);
let boostSlip = 0;
let plainSlip = 0;
for (let i = 0; i < 25; i++) stepCar(boostLow, { ...IDLE_INPUT, throttle: 1, boost: true }, track, dt, 1);
boostSlip = boostLow.longSlip;
const plainLow = car();
place(plainLow);
for (let i = 0; i < 25; i++) stepCar(plainLow, { ...IDLE_INPUT, throttle: 1 }, track, dt, 1);
plainSlip = plainLow.longSlip;
if (boostSlip < plainSlip + 0.08) fail(`boost did not add wheelspin ${plainSlip.toFixed(2)} vs ${boostSlip.toFixed(2)}`);

{
  const slide = car();
  const heldSteer = car();
  place(slide);
  place(heldSteer);
  applyLaunch(slide, 34);
  applyLaunch(heldSteer, 34);
  const provoke = { ...IDLE_INPUT, throttle: 1, steer: 1 };
  for (let i = 0; i < 50; i++) {
    stepCar(slide, provoke, track, dt, 1);
    stepCar(heldSteer, provoke, track, dt, 1);
  }
  for (let i = 0; i < 36; i++) {
    stepCar(slide, { ...IDLE_INPUT, throttle: 0.45, steer: -0.85 }, track, dt, 1);
    stepCar(heldSteer, provoke, track, dt, 1);
  }
  if (Math.abs(slide.slipAngle) > Math.abs(heldSteer.slipAngle) * 0.92) {
    fail(`countersteer did not catch ${slide.slipAngle.toFixed(2)} vs ${heldSteer.slipAngle.toFixed(2)}`);
  }
  if (Math.abs(slide.yawRate) > 2.2) fail(`countersteer spun ${slide.yawRate.toFixed(2)}`);
}

{
  const straight = car();
  place(straight);
  applyLaunch(straight, 4);
  for (let i = 0; i < 40; i++) stepCar(straight, { ...IDLE_INPUT, throttle: 1, drift: true, steer: 0.05 }, track, dt, 1);
  if (straight.drifting) fail("slow straight entered a drift");
}

{
  let maxLat = 0;
  let flipped = 0;
  const slalom = car();
  place(slalom);
  applyLaunch(slalom, 24);
  let lastSign = 0;
  for (let i = 0; i < 6 * 60; i++) {
    const steer = Math.floor(i / 24) % 2 === 0 ? 1 : -1;
    stepCar(slalom, { ...IDLE_INPUT, throttle: 1, steer }, track, dt, 1);
    maxLat = Math.max(maxLat, Math.abs(slalom.latVel));
    const sign = Math.sign(slalom.yawRate);
    if (lastSign !== 0 && sign !== 0 && sign !== lastSign) flipped++;
    if (sign !== 0) lastSign = sign;
    if (!Number.isFinite(slalom.yaw) || !Number.isFinite(slalom.forwardSpeed)) fail("slalom produced NaN");
  }
  if (maxLat > 14) fail(`slalom slid out ${maxLat.toFixed(2)}`);
  if (flipped < 4) fail(`slalom did not change direction (${flipped})`);
  if (slalom.forwardSpeed < 16) fail(`slalom killed speed ${slalom.forwardSpeed.toFixed(1)}`);
}

{
  const sim = createSim(true);
  startCountdown(sim);
  const throttle = { ...IDLE_INPUT, throttle: 1 };
  let traveled = 0;
  for (let i = 0; i < 32 * 60; i++) {
    stepSim(sim, dt, throttle, 1);
    traveled += Math.max(0, sim.cars[0]!.forwardSpeed) * dt;
  }
  for (const r of sim.cars) {
    if (!Number.isFinite(r.x) || !Number.isFinite(r.forwardSpeed) || !Number.isFinite(r.yaw)) {
      fail(`${r.name} NaN`);
    }
  }
  const aiMoved = sim.cars.filter((r) => !r.isPlayer && r.raceDist > 250).length;
  aiNote = `len ${Math.round(sim.track.length)} travel ${Math.round(traveled)} ` + sim.cars
    .map((r) => `${r.name}:${r.laps}L/${Math.round(r.forwardSpeed * 3.6)}`)
    .join(" ");
  if (traveled < 600) fail(`player barely moved on track (${Math.round(traveled)} m)`);
  if (aiMoved < 2) fail(`AI not driving ${aiNote}`);
}

console.log(
  JSON.stringify({
    cruise: +kmh.toFixed(1),
    launch: +earlyKmh.toFixed(1),
    at21: +(mid.forwardSpeed * 3.6).toFixed(1),
    shifts: gearChanges,
    coast: +coast.forwardSpeed.toFixed(1),
    brakeDist: +dist.toFixed(1),
    brakePeak: +brakePeak.toFixed(2),
    brakeTime: +brakeTime.toFixed(2),
    lowYaw: +lowYaw.toFixed(2),
    highYaw: +highYaw.toFixed(2),
    boost: +boosted.forwardSpeed.toFixed(1),
    plain: +plain.forwardSpeed.toFixed(1),
    launchSlip: +spinAtStart.toFixed(2),
    r80: calm80.radius,
    r120: limit120.radius,
    r160: hard160.radius,
    r200: tight200.radius,
    rSweep: wide200.radius,
    front200: tight200.front,
    powerAngle: [powerLow.angle, powerHigh.angle],
    brakeAngle: [brakeOff.angle, brakeOn.angle],
    ai: aiNote,
  }),
);
