import { aiCommand } from "./ai";
import { checkGate, rankCars, sectorProgress, separateCars, timeGapSeconds } from "./race";
import { createSim, startCountdown, stepSim, awardFinish } from "./simulation";
import { IDLE_INPUT } from "./types";
import { sampleAt } from "./track";
import { AI_CARS, type AiDifficulty } from "./tuning";
import { applyLaunch } from "./vehicle";

const dt = 1 / 60;
let failed = 0;
function fail(msg: string): void {
  failed++;
  console.error("FAIL", msg);
}

function untilRacing(sim: ReturnType<typeof createSim>, input = IDLE_INPUT): void {
  if (sim.phase === "menu" || sim.phase === "results") startCountdown(sim);
  for (let i = 0; i < 8 * 60 && sim.phase !== "racing"; i++) stepSim(sim, dt, input, 1);
}

const built = createSim(true);
const track = built.track;
let maxC = 0;
for (const s of track.samples) maxC = Math.max(maxC, Math.abs(s.curv));
const est = track.length / 38;
if (track.length < 1600 || track.length > 4200) fail(`track length ${Math.round(track.length)} m`);
if (est < 50 || est > 120) fail(`estimated lap ${est.toFixed(0)}s at 38 m/s`);
if (track.gates.length < 6) fail(`too few gates ${track.gates.length}`);
if (maxC > 0.03) fail(`corner too tight ${maxC.toFixed(4)}`);
const ids = track.gates.map((g) => g.id);
if (new Set(ids).size !== ids.length) fail("duplicate checkpoint ids");
if (track.gates.some((g, i) => g.next !== (i + 1) % track.gates.length)) fail("checkpoint next link");

{
  const sim = createSim(true);
  const car = sim.cars[0]!;
  const x = car.spawnX;
  const z = car.spawnZ;
  startCountdown(sim);
  for (let i = 0; i < 8; i++) stepSim(sim, dt, { ...IDLE_INPUT, throttle: 1, boost: true }, 1);
  if (sim.phase === "racing") fail(`left the grid early (${sim.phase})`);
  if (Math.hypot(car.x - x, car.z - z) > 0.05) fail("car moved before GO");
  if (Math.abs(car.forwardSpeed) > 0.01) fail("speed before GO");
  if (!sim.falseStart) fail("throttle before GO was not recorded");
  untilRacing(sim, IDLE_INPUT);
  if (sim.phase !== "racing") fail(`did not reach racing (${sim.phase})`);
  const x1 = car.x;
  const z1 = car.z;
  for (let i = 0; i < 40; i++) stepSim(sim, dt, { ...IDLE_INPUT, throttle: 1 }, 1);
  if (car.forwardSpeed < 1 && Math.hypot(car.x - x1, car.z - z1) < 0.5) fail("no launch after GO");
}

{
  const sim = createSim(true);
  const car = sim.cars[0]!;
  const finish = track.gates[track.gates.length - 1]!;
  car.nextGate = 0;
  car.laps = 0;
  car.prevX = finish.x - finish.tx * 4;
  car.prevZ = finish.z - finish.tz * 4;
  car.x = finish.x + finish.tx * 4;
  car.z = finish.z + finish.tz * 4;
  const skipped = checkGate(car, track);
  if (skipped === "lap" || car.laps > 0) fail(`shortcut counted a lap (${skipped})`);
  car.nextGate = track.gates.length - 1;
  car.prevX = finish.x - finish.tx * 4;
  car.prevZ = finish.z - finish.tz * 4;
  car.x = finish.x + finish.tx * 4;
  car.z = finish.z + finish.tz * 4;
  const hit = checkGate(car, track);
  if (hit !== "lap") fail(`ordered finish did not lap (${hit})`);
}

{
  const sim = createSim(true);
  const car = sim.cars[0]!;
  car.forwardSpeed = -12;
  car.arc = track.length * 0.5;
  car.nextGate = 3;
  if (sectorProgress(car, track) !== 0) fail("reverse advanced progress");
}

{
  const sim = createSim(true);
  const [a, b] = sim.cars;
  a!.laps = 1;
  a!.nextGate = 2;
  a!.sector = 0.4;
  a!.finished = false;
  b!.laps = 1;
  b!.nextGate = 1;
  b!.sector = 0.95;
  b!.finished = false;
  const rank = rankCars(sim.cars);
  if (rank[0] !== a) fail("checkpoint rank ignored a later gate");
}

{
  const sim = createSim(true);
  untilRacing(sim);
  sim.raceTime = 40;
  sim.cars[1]!.laps = sim.totalLaps;
  sim.cars[1]!.finished = false;
  sim.cars[1]!.finishPlace = 0;
  awardFinish(sim, sim.cars[1]!);
  if (sim.cars[1]!.finishPlace !== 1) fail("AI did not take first when it finished first");
  if (sim.phase !== "racing") fail("field ended when an AI finished");
  awardFinish(sim, sim.cars[0]!);
  if (sim.cars[0]!.finishPlace !== 2) fail(`player place ${sim.cars[0]!.finishPlace}`);
  if (sim.phase !== "finishing") fail(`player finish did not enter finishing (${sim.phase})`);
}

{
  const sim = createSim(true);
  untilRacing(sim);
  for (let i = 0; i < 90; i++) stepSim(sim, dt, { ...IDLE_INPUT, throttle: 1 }, 1);
  const moved = sim.cars[0]!.raceDist;
  sim.cars[0]!.boostEnergy = 0.2;
  sim.cars[2]!.laps = 2;
  startCountdown(sim);
  const car = sim.cars[0]!;
  if (sim.phase !== "grid") fail(`restart phase ${sim.phase}`);
  if (car.laps !== 0 || car.nextGate !== 0 || car.forwardSpeed !== 0) fail("restart left race progress");
  if (car.boostEnergy < 0.99) fail("restart did not refill nitro");
  if (sim.raceTime !== 0 || sim.finishCount !== 0) fail("restart left the clock");
  if (Math.hypot(car.x - car.spawnX, car.z - car.spawnZ) > 0.2) fail("restart did not restore the grid");
  if (moved < 5) fail("pre-restart car never moved");
}

function forwardOf(car: { yaw: number; vx: number; vz: number }): number {
  const fx = -Math.sin(car.yaw);
  const fz = -Math.cos(car.yaw);
  return car.vx * fx + car.vz * fz;
}

{
  const sim = createSim(true);
  const a = sim.cars[0]!;
  const b = sim.cars[1]!;
  a.x = 0;
  a.z = 0;
  a.yaw = 0;
  a.vx = 0;
  a.vz = -28;
  a.yawRate = 0;
  a.forwardSpeed = 28;
  b.x = 0;
  b.z = -4;
  b.yaw = 0;
  b.vx = 0;
  b.vz = -16;
  b.yawRate = 0;
  b.forwardSpeed = 16;
  const yA = a.y;
  separateCars([a, b]);
  const sa = forwardOf(a);
  const sb = forwardOf(b);
  if (![a, b].every((c) => Number.isFinite(c.x) && Number.isFinite(c.vx) && Number.isFinite(c.yawRate))) {
    fail("collision produced NaN");
  }
  if (sa > 26.2) fail(`rear hit did not slow the bumper ${sa.toFixed(2)}`);
  if (sb < 17.5) fail(`rear hit did not push the car ahead ${sb.toFixed(2)}`);
  if (Math.abs(a.y - yA) > 0.01 || a.vy !== 0 || b.vy !== 0) fail("contact launched a car");
  if (Math.hypot(b.x - a.x, b.z - a.z) < 3.2) fail("rear contact left the cars inside each other");
}

{
  const sim = createSim(true);
  const a = sim.cars[0]!;
  const b = sim.cars[1]!;
  a.x = 0;
  a.z = 0;
  a.yaw = 0;
  a.vx = 12;
  a.vz = 0;
  a.yawRate = 0;
  b.x = 1.45;
  b.z = 0.2;
  b.yaw = 0;
  b.vx = 0;
  b.vz = 0;
  b.yawRate = 0;
  separateCars([a, b]);
  if (b.vx < 1.2) fail(`side hit did not push the other car ${b.vx.toFixed(2)}`);
  if (a.vx > 11) fail(`side hit did not slow the hitter ${a.vx.toFixed(2)}`);
  if (Math.abs(b.x - a.x) < 1.7) fail("side hit did not separate");
}

{
  const sim = createSim(true);
  const a = sim.cars[0]!;
  const b = sim.cars[1]!;
  a.x = 0;
  a.z = 0;
  a.yaw = 0;
  a.vx = 0;
  a.vz = -24;
  a.yawRate = 0;
  b.x = 0;
  b.z = -4.5;
  b.yaw = Math.PI;
  b.vx = 0;
  b.vz = 22;
  b.yawRate = 0;
  separateCars([a, b]);
  const sa = forwardOf(a);
  const sb = forwardOf(b);
  if (sa > 16) fail(`head-on kept too much speed ${sa.toFixed(1)}`);
  if (sb > 16) fail(`head-on rival kept too much speed ${sb.toFixed(1)}`);
  if (Math.abs(a.vx) > 30 || Math.abs(b.vx) > 30) fail("head-on flung a car sideways");
}

{
  const sim = createSim(true);
  const a = sim.cars[0]!;
  const b = sim.cars[1]!;
  a.x = 0;
  a.z = 0;
  a.yaw = 0;
  a.vx = 0;
  a.vz = -20;
  a.yawRate = 0;
  b.x = 0;
  b.z = -4.55;
  b.yaw = 0;
  b.vx = 0;
  b.vz = -19.2;
  b.yawRate = 0;
  separateCars([a, b]);
  const sa = forwardOf(a);
  const sb = forwardOf(b);
  if (Math.abs(sa - 20) > 1.6) fail(`light tap changed speed too much ${sa.toFixed(2)}`);
  if (Math.abs(sb - 19.2) > 1.6) fail(`light tap launched the other car ${sb.toFixed(2)}`);
}

{
  const sim = createSim(true);
  const player = sim.cars[0]!;
  const vex = sim.cars[1]!;
  player.raceDist = 400;
  vex.raceDist = 520;
  player.forwardSpeed = 40;
  vex.forwardSpeed = 40;
  const ahead = timeGapSeconds(player, vex);
  if (ahead < 2.4 || ahead > 3.6) fail(`ahead gap ${ahead.toFixed(2)}`);
  vex.raceDist = 280;
  const behind = timeGapSeconds(player, vex);
  if (behind > -2.4 || behind < -3.6) fail(`behind gap ${behind.toFixed(2)}`);
}

{
  const sim = createSim(true);
  sim.totalLaps = 1;
  sim.debugAutoPlayer = true;
  untilRacing(sim);
  const seen: Record<string, Set<string>> = {};
  const crash: Record<string, number> = {};
  const tightNitro: Record<string, number> = {};
  const boostFrames: Record<string, number> = {};
  let steps = 0;
  while ((sim.phase === "racing" || sim.phase === "finishing") && steps < 170 * 60) {
    stepSim(sim, dt, IDLE_INPUT, 1);
    steps++;
    for (const car of sim.cars) {
      if (car.finished) continue;
      seen[car.name] ??= new Set();
      seen[car.name]!.add(car.aiState);
      if (car.crashPulse > 0.3) crash[car.name] = (crash[car.name] ?? 0) + 1;
      if (car.boosting) boostFrames[car.name] = (boostFrames[car.name] ?? 0) + 1;
      const curv = sim.track.samples[car.hint]?.curv ?? 0;
      if (car.aiState === "NITRO" && Math.abs(curv) > 0.012) tightNitro[car.name] = (tightNitro[car.name] ?? 0) + 1;
    }
    if (sim.cars.every((car) => car.finished)) break;
  }
  const line = sim.cars
    .map((c) => `${c.name}:${c.laps}L/g${c.nextGate}/${c.finished ? c.finishPlace : "run"}/${Math.round(c.forwardSpeed * 3.6)}`)
    .join(" ");
  if (sim.cars[0]!.laps < 1) fail(`player did not finish a lap ${line}`);
  const aiDone = sim.cars.filter((c) => !c.isPlayer && c.laps >= 1).length;
  if (aiDone < 3) fail(`AI did not complete the lap ${line}`);
  if (sim.phase !== "finishing" && sim.phase !== "results") fail(`bad phase ${sim.phase}`);
  const places = sim.cars.map((c) => c.finishPlace);
  if (new Set(places.filter((p) => p > 0)).size < 4) fail(`finish places collapsed ${places.join(",")}`);
  const vex = sim.cars[1]!;
  const ion = sim.cars[2]!;
  const nyx = sim.cars[3]!;
  if (!(vex.finishTime > 0 && nyx.finishTime > vex.finishTime + 4)) {
    fail(`VEX was not clearly faster than NYX (${vex.finishTime.toFixed(1)} vs ${nyx.finishTime.toFixed(1)})`);
  }
  if (!(ion.finishTime > vex.finishTime && ion.finishTime < nyx.finishTime)) {
    fail(`ION was not between VEX and NYX (${vex.finishTime.toFixed(1)} / ${ion.finishTime.toFixed(1)} / ${nyx.finishTime.toFixed(1)})`);
  }
  for (const car of [vex, ion, nyx]) {
    const states = seen[car.name] ?? new Set();
    if (!states.has("BRAKE")) fail(`${car.name} never braked`);
    if (!states.has("NITRO")) fail(`${car.name} never used nitro`);
    if ((crash[car.name] ?? 0) > 40) fail(`${car.name} rode the wall ${crash[car.name]} frames`);
    if ((tightNitro[car.name] ?? 0) > 0) fail(`${car.name} used nitro in the hairpin`);
    if (!Number.isFinite(car.finishTime) || !Number.isFinite(car.x)) fail(`${car.name} produced NaN`);
  }
  if ((boostFrames.VEX ?? 0) <= (boostFrames.NYX ?? 0)) fail("VEX did not use more nitro than NYX");
  if (!Object.values(seen).some((set) => set.has("OVERTAKE"))) fail("nobody attempted an overtake");
  console.log("lap", line, "t", sim.raceTime.toFixed(1), "phase", sim.phase);

  const easy = createSim(true);
  easy.totalLaps = 1;
  easy.debugAutoPlayer = true;
  easy.difficulty = "easy";
  untilRacing(easy);
  let easySteps = 0;
  while ((easy.phase === "racing" || easy.phase === "finishing") && easySteps < 170 * 60) {
    stepSim(easy, dt, IDLE_INPUT, 1);
    easySteps++;
    if (easy.cars[1]!.finished && easy.cars[3]!.finished) break;
  }
  const easyVex = easy.cars[1]!.finishTime;
  const easyNyx = easy.cars[3]!.finishTime;
  if (!(easyVex > vex.finishTime + 1)) fail(`easy VEX was not slower (${easyVex.toFixed(1)} vs ${vex.finishTime.toFixed(1)})`);
  if (!(easyNyx > nyx.finishTime + 1)) fail(`easy NYX was not slower (${easyNyx.toFixed(1)} vs ${nyx.finishTime.toFixed(1)})`);
  if ((easy.cars[3]!.nitroUses ?? 0) > nyx.nitroUses) fail("easy NYX used more nitro than normal");
}

for (const ai of AI_CARS) {
  if (ai.accelMul !== 1 || ai.maxSpeedMul !== 1) fail(`${ai.name} changes engine or grip`);
}

{
  let bestI = 0;
  let bestC = 0;
  for (let i = 0; i < track.samples.length; i++) {
    const c = Math.abs(track.samples[i]!.curv);
    if (c > bestC) {
      bestC = c;
      bestI = i;
    }
  }
  const apex = track.samples[bestI]!;
  let rightInside = 0;
  let leftInside = 0;
  let slow = apex.speed;
  let fast = 0;
  for (const s of track.samples) {
    if (s.curv < -0.006 && s.line > 1.2) rightInside++;
    if (s.curv > 0.008 && s.line < -1) leftInside++;
    slow = Math.min(slow, s.speed);
    fast = Math.max(fast, s.speed);
  }
  if (rightInside < 8) fail("right-hand corners are not apexed inside");
  if (leftInside < 3) fail("left-hand corners are not apexed inside");
  if (fast - slow < 12) fail("corner target speeds are flat");

  const at = (name: string, diff: AiDifficulty, back: number) => {
    const sim = createSim(true);
    const s = sampleAt(sim.track, apex.dist - back);
    const car = sim.cars[1]!;
    car.ai = AI_CARS.find((profile) => profile.name === name) ?? car.ai;
    car.forwardSpeed = 46;
    car.x = s.x + s.rx * s.line;
    car.z = s.z + s.rz * s.line;
    car.yaw = Math.atan2(-s.tx, -s.tz);
    car.aiSteer = 0;
    car.stuck = 0;
    car.slipAngle = 0;
    car.boostEnergy = 1;
    car.boostLock = 0;
    car.lane = 0;
    car.hint = -1;
    return aiCommand(car, sim.track, dt, [car], diff, 12);
  };
  const vexBrake = at("VEX", "normal", 120).brake;
  const nyxBrake = at("NYX", "normal", 120).brake;
  const easyBrake = at("VEX", "easy", 120).brake;
  const hardBrake = at("VEX", "hard", 120).brake;
  if (nyxBrake <= vexBrake + 0.2) fail(`NYX did not brake earlier (${nyxBrake} vs ${vexBrake})`);
  if (easyBrake <= hardBrake + 0.2) fail(`easy did not brake earlier (${easyBrake} vs ${hardBrake})`);
}

{
  const sim = createSim(true);
  untilRacing(sim);
  for (let i = 0; i < 20; i++) stepSim(sim, dt, IDLE_INPUT, 1);
  const vex = sim.cars[1]!;
  const steer0 = vex.aiSteer;
  const a = aiCommand(vex, sim.track, dt, sim.cars, "normal", 8);
  vex.aiSteer = steer0;
  const laps = sim.cars[0]!.laps;
  const gate = sim.cars[0]!.nextGate;
  const sector = sim.cars[0]!.sector;
  sim.cars[0]!.laps = 3;
  sim.cars[0]!.nextGate = 0;
  sim.cars[0]!.sector = 0.95;
  const b = aiCommand(vex, sim.track, dt, sim.cars, "normal", 8);
  sim.cars[0]!.laps = laps;
  sim.cars[0]!.nextGate = gate;
  sim.cars[0]!.sector = sector;
  if (a.throttle !== b.throttle || a.brake !== b.brake || a.boost !== b.boost || Math.abs(a.steer - b.steer) > 1e-6) {
    fail("AI changed pace because the player gained race position");
  }
}

{
  const sim = createSim(true);
  untilRacing(sim);
  for (let i = 0; i < 40; i++) stepSim(sim, dt, IDLE_INPUT, 1);
  const car = sim.cars[1]!;
  const s = sampleAt(sim.track, car.arc);
  car.x += s.rx * 6.2;
  car.z += s.rz * 6.2;
  const arc0 = car.arc;
  stepSim(sim, dt, IDLE_INPUT, 1);
  const lat0 = Math.abs(car.latOff);
  for (let i = 0; i < 180; i++) stepSim(sim, dt, IDLE_INPUT, 1);
  if (Math.abs(car.latOff) > lat0 - 0.35) fail(`recovery left the car wide (${lat0.toFixed(2)} -> ${car.latOff.toFixed(2)})`);
  let delta = car.arc - arc0;
  if (delta < -sim.track.length * 0.5) delta += sim.track.length;
  if (delta < -25) fail("recovery teleported the car");
}

{
  const sim = createSim(true);
  untilRacing(sim);
  for (let i = 0; i < 40 * 60; i++) stepSim(sim, dt, { ...IDLE_INPUT, throttle: 0.5 }, 1);
  const gap = sim.cars[1]!.raceDist - sim.cars[0]!.raceDist;
  if (gap < 70) fail(`a slow player was not dropped (${gap.toFixed(0)} m)`);
}

{
  const sim = createSim(true);
  untilRacing(sim);
  const a = sim.cars[0]!;
  const b = sim.cars[1]!;
  const s = sampleAt(sim.track, 80);
  const yaw = Math.atan2(-s.tx, -s.tz);
  a.x = s.x;
  a.z = s.z;
  a.y = s.y;
  a.yaw = yaw;
  b.x = s.x + s.tx * 2.7;
  b.z = s.z + s.tz * 2.7;
  b.y = s.y;
  b.yaw = yaw;
  applyLaunch(a, 34);
  applyLaunch(b, 12);
  a.hint = -1;
  b.hint = -1;
  a.prevX = a.x;
  a.prevZ = a.z;
  b.prevX = b.x;
  b.prevZ = b.z;
  const leadBefore = b.forwardSpeed;
  let hit = 0;
  let leadPeak = leadBefore;
  for (let i = 0; i < 8; i++) {
    stepSim(sim, dt, { ...IDLE_INPUT, throttle: 1 }, 1);
    hit = Math.max(hit, a.crashPulse, b.crashPulse);
    leadPeak = Math.max(leadPeak, b.forwardSpeed);
  }
  if (hit < 0.12) fail(`race contact did not register (${hit.toFixed(2)})`);
  if (leadPeak < leadBefore + 2.5) fail(`lead car did not take the bump (${leadBefore.toFixed(1)} -> ${leadPeak.toFixed(1)})`);
  for (let i = 0; i < 20; i++) stepSim(sim, dt, { ...IDLE_INPUT, throttle: 1 }, 1);
  if (Math.hypot(a.x - b.x, a.z - b.z) < 2.1) fail("cars stayed locked together");
  if (![a, b].every((c) => Number.isFinite(c.forwardSpeed) && c.y < 2.5 && Math.abs(c.vy) < 0.05)) fail("contact left the ground");
}

if (failed) {
  console.error(failed, "failed");
  process.exit(1);
}
console.log("race-check ok", {
  length: Math.round(track.length),
  gates: track.gates.length,
  maxCurv: +maxC.toFixed(4),
  est: +est.toFixed(0),
});
