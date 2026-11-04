#!/usr/bin/env node
/**
 * Visual QA harness for the vehicle/road reconstruction.
 *
 * Drives the real UI (menu flow), parks the dev-only inspect camera around a
 * car and writes stills to screenshots/<prefix>/. Run it against the dev
 * server:  node scripts/visual-qa.mjs
 *
 * Flags:
 *   --tracks apex,nightfall,velocity,overdrive
 *   --cars vector,vanta,surge,aegis
 *   --views front,side,rear,qfront,qrear,chase,df,dr,wheel
 *   --prefix recon            (output folder screenshots/<prefix>/)
 *   --race                    also capture a live race from the real camera
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { checkedOutputPath, outputRoots, repoRoot } from "./browser-guard.mjs";

const TRACKS = ["apex", "nightfall", "velocity", "overdrive"];
const CARS = ["vector", "vanta", "surge", "aegis"];
// Keep the outside tire within the kerb band while leaving the body extra
// room from the barrier face.
const KERB_WHEEL_INSET = 0.58;
const VIEWS = {
  front: { angle: 0, dist: 7, height: 1.5, look: 0.55, fov: 42 },
  // Car 0 starts on the negative lateral side of the grid; look inward so
  // the barrier never sits between the camera and the side profile.
  side: { angle: -Math.PI / 2, dist: 8.2, height: 1.55, look: 0.58, fov: 42 },
  sideHigh: { angle: -Math.PI / 2, dist: 9.4, height: 2.3, look: 0.7, fov: 42 },
  rear: { angle: Math.PI, dist: 7, height: 1.55, look: 0.6, fov: 42 },
  qfront: { angle: 0.72, dist: 7.4, height: 1.7, look: 0.6, fov: 45 },
  qrear: { angle: Math.PI - 0.72, dist: 7.8, height: 1.9, look: 0.6, fov: 45 },
  chase: { angle: Math.PI, dist: 8.6, height: 2.75, look: 1.0, fov: 60 },
  low: { angle: Math.PI - 0.5, dist: 6.4, height: 0.75, look: 0.5, fov: 45 },
  df: { angle: 0.5, dist: 3.1, height: 0.7, look: 0.5, fov: 40 },
  dr: { angle: Math.PI - 0.55, dist: 3.2, height: 0.8, look: 0.5, fov: 40 },
  dw: { angle: Math.PI / 2, dist: 3.6, height: 0.55, look: 0.4, fov: 40 },
  // Keep the whole silhouette visible while the front wheel remains the focal point.
  wheel: { angle: Math.PI / 2 + 0.5, dist: 7.6, height: 0.95, look: 0.42, fov: 48 },
  asphalt: { angle: -Math.PI / 2, dist: 8.2, height: 0.75, look: 0.25, fov: 42 },
};

function parseFlags(argv) {
  const out = {
    tracks: TRACKS,
    cars: CARS,
    views: Object.keys(VIEWS),
    prefix: "recon-2.1",
    race: false,
    set: "",
    only: "",
    refresh: false,
    perf: false,
    resume: false,
    headed: false,
    url: "http://127.0.0.1:8080/?qa=1&unlock=1",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--tracks") out.tracks = argv[++i].split(",");
    else if (a === "--cars") out.cars = argv[++i].split(",");
    else if (a === "--views") out.views = argv[++i].split(",");
    else if (a === "--prefix") out.prefix = argv[++i];
    else if (a === "--url") out.url = argv[++i];
    else if (a === "--race") out.race = true;
    else if (a === "--set") out.set = argv[++i];
    else if (a === "--only") out.only = argv[++i];
    else if (a === "--refresh") out.refresh = true;
    else if (a === "--perf") out.perf = true;
    else if (a === "--resume") out.resume = true;
    else if (a === "--headed") out.headed = true;
    else if (a === "--help" || a === "-h") {
      console.log("see header of scripts/visual-qa.mjs");
      process.exit(0);
    } else {
      console.error(`unknown flag: ${a}`);
      process.exit(1);
    }
  }
  return out;
}

const args = parseFlags(process.argv.slice(2));
const outDir = checkedOutputPath(join(repoRoot(), "screenshots", args.prefix), outputRoots(), "screenshot directory");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: !args.headed, args: ["--no-sandbox"] });
const page = await browser.newPage({
  viewport: args.perf ? { width: 1280, height: 720 } : { width: 1600, height: 900 },
});
const consoleErrors = [];
const transitionMemory = [];
const imageChecks = [];
const checkPath = checkedOutputPath(join(outDir, "image-checks.json"), outputRoots());
const writeImageChecks = () => {
  const priorImages = args.resume && existsSync(checkPath)
    ? JSON.parse(readFileSync(checkPath, "utf8")).images ?? []
    : [];
  const merged = new Map(priorImages.map((check) => [check.file, check]));
  for (const check of imageChecks) merged.set(check.file, check);
  const checkedImages = [...merged.values()];
  writeFileSync(checkPath, JSON.stringify({ ok: checkedImages.every((check) => check.pass), images: checkedImages }, null, 2));
};
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

const HIDE_UI = () => {
  const canvas = document.querySelector("canvas.game-canvas") || document.querySelector("canvas");
  document.querySelectorAll("body *").forEach((el) => {
    if (canvas && (el === canvas || el.contains(canvas) || canvas.contains(el))) return;
    el.style.opacity = "0";
    el.style.pointerEvents = "none";
  });
};

const SHOW_UI = () => {
  document.querySelectorAll("body *").forEach((el) => {
    el.style.opacity = "";
    el.style.pointerEvents = "";
  });
};

/** Vite HMR can reload the page mid-run; wait the game hook back first. */
const settleContext = async () => {
  for (let i = 0; i < 30; i++) {
    try {
      await page.waitForFunction(() => Boolean(window.__controlsTest), null, { timeout: 4000 });
      await page.evaluate(HIDE_UI);
      return;
    } catch {
      await page.waitForTimeout(400);
    }
  }
  throw new Error("game never came back after reload");
};

const evalRetry = async (fn, arg) => {
  for (let i = 0; i < 6; i++) {
    try {
      return await page.evaluate(fn, arg);
    } catch (err) {
      if (!String(err).includes("context")) throw err;
      await settleContext();
    }
  }
  throw new Error("evaluate kept failing");
};

const wait = (ms) => page.waitForTimeout(ms);
const settle = (ms = 700) => wait(ms);

const clickButton = (label) =>
  evalRetry((text) => {
    const buttons = [...document.querySelectorAll("button")];
    const el =
      buttons.find((b) => b.textContent.trim().toLowerCase() === text.toLowerCase()) ||
      buttons.find((b) => b.textContent.trim().toLowerCase().includes(text.toLowerCase()));
    if (!el) return false;
    el.click();
    return true;
  }, label);

const clickCard = (index) =>
  evalRetry((i) => {
    const cards = [...document.querySelectorAll(".garage-card")];
    if (!cards[i]) return false;
    cards[i].click();
    return true;
  }, index);

/** Open a picker, retrying if a hot reload reset the UI to the title. */
const ensurePicker = async (label) => {
  for (let i = 0; i < 4; i++) {
    const count = await evalRetry(() => document.querySelectorAll(".garage-card").length);
    if (count > 0) return;
    await settleContext().catch(() => {});
    await clickButton(label).catch(() => {});
    await settle(600);
  }
  throw new Error(`picker not open: ${label}`);
};

const openScreen = async (label) => {
  const ok = await clickButton(label);
  if (!ok) throw new Error(`button not found: ${label}`);
  await settle(450);
};

const toTitle = async () => {
  await clickButton("Done").catch(() => {});
  await clickButton("Menu").catch(() => {});
  await settle(350);
};

const setInspect = (spec) => evalRetry((s) => window.__controlsTest.setInspect(s), spec);

const shot = async (name, expectedCar, { showUI = false } = {}) => {
  if (args.only === "races" && !name.startsWith("race-")) return;
  // Screens remount on every navigation, so re-hide right before the capture.
  await evalRetry(showUI ? SHOW_UI : HIDE_UI);
  await settle(90);
  const identity = await evalRetry(() => window.__controlsTest.carIdentity());
  const expected = expectedCar?.toLowerCase();
  if (
    identity.selected !== identity.loaded ||
    (expected && identity.loaded !== expected) ||
    identity.cameraLoaded !== (expected ?? identity.loaded)
  ) {
    throw new Error(
      `${name}: car identity mismatch (expected ${expected ?? "selected"}, selected ${identity.selected}, loaded ${identity.loaded}, camera ${identity.cameraLoaded ?? "none"} at ${identity.cameraIndex})`,
    );
  }
  const path = checkedOutputPath(join(outDir, `${name}.png`), outputRoots());
  if (!args.resume || args.refresh || !existsSync(path)) await page.screenshot({ path, timeout: 90000 });
  else console.log(`verified existing ${path}`);
  imageChecks.push({
    file: `${name}.png`,
    expectedCarId: expected ?? identity.loaded,
    selectedCarId: identity.selected,
    loadedCarId: identity.loaded,
    cameraCarId: identity.cameraLoaded,
    pass: true,
  });
  writeImageChecks();
  console.log(`wrote ${path}`);
};

await page.goto(args.url, { waitUntil: "domcontentloaded" });
await settleContext();

async function park(track, car, view, name) {
  await settleContext();
  await toTitle();
  await ensurePicker("Tracks");
  if (!(await clickCard(TRACKS.indexOf(track)))) throw new Error(`track card missing: ${track}`);
  await settle(700);
  await toTitle();
  await ensurePicker("Cars");
  if (!(await clickCard(CARS.indexOf(car)))) throw new Error(`car card missing: ${car}`);
  await settle(700);
  await toTitle();
  const { playerIndex } = await evalRetry(() => window.__controlsTest.carIdentity());
  await evalRetry((index) => window.__controlsTest.setSoloCar(index), playerIndex);
  const inspect = { car: playerIndex, ...VIEWS[view] };
  if (view === "wheel") {
    const { wheelLayout } = await evalRetry(() => window.__controlsTest.carIdentity());
    inspect.focusX = wheelLayout.frontX;
    inspect.focusZ = wheelLayout.frontZ;
    inspect.look = wheelLayout.frontRadius + 0.04;
  }
  await setInspect({ ...inspect, freeze: true });
  await settle(280);
  await shot(name, car);
}

async function contactShot(name, spec, car = "vector") {
  const { playerIndex } = await evalRetry(() => window.__controlsTest.carIdentity());
  await evalRetry((index) => window.__controlsTest.setSoloCar(index), playerIndex);
  await evalRetry(() => window.__controlsTest.clearInspect());
  await evalRetry((s) => window.__controlsTest.placeAt(s.arc, s.lat), spec);
  await settle(250);
  await setInspect({ car: playerIndex, angle: spec.angle ?? Math.PI / 2, dist: spec.dist ?? 6.2, height: spec.height ?? 1.15, look: 0.45, fov: 46, freeze: true });
  await settle(280);
  await shot(name, car);
}

async function captureRace(track) {
  await toTitle();
  await ensurePicker("Tracks");
  if (!(await clickCard(TRACKS.indexOf(track)))) throw new Error(`track card missing: ${track}`);
  await settle(600);
  await toTitle();
  await openScreen("Race");
  await clickButton("Next — track").catch(() => {});
  await settle(300);
  const started = await clickButton("Start race");
  if (!started) await clickButton("Race");
  await page
    .waitForFunction(() => ["racing", "countdown", "grid"].includes(window.__controlsTest?.phase?.() ?? ""), null, { timeout: 20000 })
    .catch(() => {});
  await settle(800);
  await evalRetry(() => window.__controlsTest.clearInspect());
  const { playerIndex } = await evalRetry(() => window.__controlsTest.carIdentity());
  await evalRetry(() => window.__controlsTest.setSoloCar(null));
  await page.keyboard.down("KeyW");
  await wait(1800);
  await evalRetry((index) => window.__controlsTest.setSoloCar(index), playerIndex);
  await setInspect({ car: playerIndex, angle: Math.PI, dist: 10.5, height: 2.8, look: 0.8, fov: 50, freeze: true });
  await settle(250);
  await shot(`race-${track}`, "vector");
  await evalRetry(() => window.__controlsTest.setSoloCar(null));
  transitionMemory.push({ track, ...(await evalRetry(() => window.__controlsTest.renderStats())) });
  await page.keyboard.up("KeyW");
  await clickButton("Quit").catch(() => {});
  await settle(400);
}

if (args.set === "kerbtest") {
  await toTitle();
  await ensurePicker("Tracks");
  if (!(await clickCard(TRACKS.indexOf("nightfall")))) throw new Error("nightfall missing");
  await settle(800);
  await toTitle();
  await ensurePicker("Cars");
  if (!(await clickCard(CARS.indexOf("vector")))) throw new Error("vector missing");
  await settle(700);
  await toTitle();
  const probe = await evalRetry(() => window.__controlsTest.trackProbe());
  const identity = await evalRetry(() => window.__controlsTest.carIdentity());
  if (identity.selected !== "vector" || identity.loaded !== "vector") throw new Error("vector not loaded for kerb test");
  const road = await evalRetry((arc) => window.__controlsTest.trackAt(arc), probe.kerb);
  const lat = road.half - KERB_WHEEL_INSET - Math.max(identity.wheelLayout.frontX, identity.wheelLayout.rearX);
  await contactShot("kerb-curve", { arc: probe.kerb, lat, angle: Math.PI / 2, height: 1.4, dist: 8.2 });
  await contactShot("kerb-curve-side", { arc: probe.kerb, lat, angle: Math.PI / 2, height: 1.4, dist: 8.2 });
} else if (args.set === "races") {
  await toTitle();
  await ensurePicker("Cars");
  if (!(await clickCard(CARS.indexOf("vector")))) throw new Error("vector missing before gameplay captures");
  await settle(650);
  await toTitle();
  for (const track of TRACKS) await captureRace(track);
} else if (args.set === "details") {
  for (const car of CARS) await park("apex", car, "wheel", `${car}-wheel`);
  await park("apex", "vector", "asphalt", "asphalt-close");
  await toTitle();
  await openScreen("Cars");
  await page.waitForFunction(() => document.querySelectorAll(".garage-card").length === 4);
  await page.setViewportSize({ width: 1600, height: 1200 });
  await settle(350);
  await shot("garage", "vector", { showUI: true });
} else if (args.set === "recon21") {
  await park("apex", "vector", "qfront", "vector-qfront");
  await park("apex", "vector", "side", "vector-side");
  await park("apex", "vector", "wheel", "vector-wheel");
  await park("apex", "vanta", "qfront", "vanta-qfront");
  await park("apex", "vanta", "side", "vanta-side");
  await park("apex", "vanta", "wheel", "vanta-wheel");
  await park("apex", "surge", "qfront", "surge-qfront");
  await park("apex", "surge", "side", "surge-side");
  await park("apex", "surge", "wheel", "surge-wheel");
  await park("apex", "aegis", "qfront", "aegis-qfront");
  await park("apex", "aegis", "side", "aegis-side");
  await park("apex", "aegis", "wheel", "aegis-wheel");
  await park("apex", "vector", "asphalt", "asphalt-close");
  await park("apex", "vector", "chase", "barrier-chase");

  await toTitle();
  await ensurePicker("Tracks");
  if (!(await clickCard(TRACKS.indexOf("nightfall")))) throw new Error("nightfall missing");
  await settle(800);
  await toTitle();
  const probe = await evalRetry(() => window.__controlsTest.trackProbe());
  const kerbLatFor = async (car, arc) => {
    const identity = await evalRetry(() => window.__controlsTest.carIdentity());
    if (identity.selected !== car || identity.loaded !== car) {
      throw new Error(`cannot place ${car} on kerb; selected=${identity.selected}, loaded=${identity.loaded}`);
    }
    const layout = identity.wheelLayout;
    const road = await evalRetry((at) => window.__controlsTest.trackAt(at), arc);
    // Curves can be narrower than the start line. Place outer tire centers in
    // the inner half of the local kerb band, leaving body clearance from the wall.
    return Math.max(0, road.half - KERB_WHEEL_INSET - Math.max(layout.frontX, layout.rearX));
  };
  const straightLat = await kerbLatFor("vector", 40);
  const curveLat = await kerbLatFor("vector", probe.kerb);
  await contactShot("kerb-straight", { arc: 40, lat: straightLat, angle: Math.PI / 2, height: 1.35, dist: 7.1 });
  await contactShot("kerb-curve", { arc: probe.kerb, lat: curveLat, angle: Math.PI / 2, height: 1.4, dist: 8.2 });

  // Run the same road-contact cases with each authored vehicle selected in the
  // live application, so the wheel layout and the rendered wheel assemblies
  // stay in the loop for these captures.
  for (const [carIndex, car] of CARS.entries()) {
    await toTitle();
    await ensurePicker("Cars");
    if (!(await clickCard(carIndex))) throw new Error(`car card missing: ${car}`);
    await settle(700);
    await toTitle();
    const kerbLat = await kerbLatFor(car, probe.kerb);
    const gradientLat = await kerbLatFor(car, probe.kerbGradient);
    const transitionLat = await kerbLatFor(car, probe.kerb + 12);
    const contact = (name, spec) => contactShot(`contact-${car}-${name}`, spec, car);
    await contact("flat", { arc: 30, lat: 0, angle: Math.PI / 2, height: 1.1 });
    await contact("uphill", { arc: probe.uphill, lat: 0, angle: Math.PI / 2, height: 1.2 });
    await contact("downhill", { arc: probe.downhill, lat: 0, angle: Math.PI / 2, height: 1.2 });
    await contact("crest", { arc: probe.crest, lat: 0, angle: Math.PI / 2 + 0.4, height: 1.3 });
    await contact("road-transition", { arc: probe.transition, lat: 0, angle: 0.9, height: 1.15 });
    await contact("kerb-left", { arc: probe.kerb, lat: kerbLat, angle: Math.PI / 2, height: 1.35, dist: 7.1 });
    await contact("kerb-right", { arc: probe.kerb, lat: -kerbLat, angle: -Math.PI / 2, height: 1.35, dist: 7.1 });
    await contact("kerb-gradient", { arc: probe.kerbGradient, lat: gradientLat, angle: 0.4, height: 1.5, dist: 7.5 });
    await contact("kerb-transition", { arc: probe.kerb + 12, lat: transitionLat, angle: 0.9, height: 1.5, dist: 7.6 });
  }

  await toTitle();
  await ensurePicker("Cars");
  if (!(await clickCard(CARS.indexOf("vector")))) throw new Error("vector missing before gameplay captures");
  await settle(650);
  await toTitle();

  for (const track of TRACKS) await captureRace(track);
} else {
// --- menu capture: every track x every car, parked views -------------------
for (const track of args.tracks) {
  await settleContext();
  const trackIndex = TRACKS.indexOf(track);
  if (trackIndex < 0) throw new Error(`unknown track ${track}`);
  await toTitle();
  await ensurePicker("Tracks");
  if (!(await clickCard(trackIndex))) throw new Error("track card missing");
  await settle(900);
  await toTitle();

  for (const car of args.cars) {
    const carIndex = CARS.indexOf(car);
    if (carIndex < 0) throw new Error(`unknown car ${car}`);
    await toTitle();
    await ensurePicker("Cars");
    if (!(await clickCard(carIndex))) throw new Error("car card missing");
    await settle(900);
    await toTitle();
    await settle(400);
    for (const view of args.views) {
      await evalRetry(() => window.__controlsTest.setSoloCar(0));
      await setInspect({ car: 0, ...VIEWS[view], freeze: true });
      await settle(230);
      await shot(`${track}-${car}-${view}`, car);
    }
  }
}
}

if (args.race && args.set !== "recon21") {
  await toTitle();
  await openScreen("Race");
  await clickButton("Next — track");
  await settle(450);
  await clickButton("Start race");
  await page
    .waitForFunction(() => ["racing", "countdown"].includes(window.__controlsTest?.phase()), null, { timeout: 30000 })
    .catch(() => {});
  await settle(1400);
  await evalRetry(() => window.__controlsTest.clearInspect());
  await settle(400);
  await shot("race-start-chase");
  await page.keyboard.down("KeyW");
  await wait(2600);
  await shot("race-driving-chase");
  await page.keyboard.up("KeyW");
  await setInspect({ car: 0, angle: Math.PI * 0.82, dist: 9, height: 2.4, look: 1, fov: 52, freeze: true });
  await settle(350);
  await shot("race-frozen-field");
}

let perf = null;
if (args.perf) {
  const phase = await evalRetry(() => window.__controlsTest.phase());
  if (!["racing", "countdown", "grid"].includes(phase)) {
    await toTitle();
    await openScreen("Race");
    await clickButton("Next — track").catch(() => {});
    await settle(300);
    const started = await clickButton("Start race");
    if (!started) await clickButton("Race");
    await page
      .waitForFunction(() => ["racing", "countdown", "grid"].includes(window.__controlsTest?.phase?.() ?? ""), null, { timeout: 20000 })
      .catch(() => {});
    await settle(1200);
  }
  await evalRetry(() => window.__controlsTest.clearInspect());
  perf = {};
  for (const quality of ["low", "medium", "high"]) {
    await evalRetry((q) => window.__controlsTest.setQuality(q), quality);
    await settle(400);
    // Low normally hides decorative dressing for mobile speed. The QA matrix
    // forces it on for every tier so this comparison includes full scenery.
    await evalRetry((visible) => window.__controlsTest.setDressingVisible(visible), true);
    // Allow newly enabled scene materials and the shadow target to compile
    // before collecting frame pacing samples.
    await settle(900);
    const times = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const samples = [];
          let last = performance.now();
          let n = 0;
          const frame = (t) => {
            samples.push(t - last);
            last = t;
            n += 1;
          if (n < 601) requestAnimationFrame(frame);
            else resolve(samples.slice(1));
          };
          requestAnimationFrame(frame);
        }),
    );
    const sorted = [...times].sort((a, b) => a - b);
    const avg = times.reduce((s, v) => s + v, 0) / times.length;
    const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))];
    const tail = sorted.slice(-Math.max(1, Math.ceil(sorted.length * 0.01)));
    const tailAvg = tail.reduce((s, v) => s + v, 0) / tail.length;
    perf[quality] = {
      frames: times.length,
      avgMs: Number(avg.toFixed(2)),
      avgFps: Number((1000 / avg).toFixed(1)),
      p99Ms: Number(p99.toFixed(2)),
      onePercentLowFps: Number((1000 / tailAvg).toFixed(1)),
      minFps: Number((1000 / sorted[sorted.length - 1]).toFixed(1)),
      fullScenery: true,
      render: await evalRetry(() => window.__controlsTest.renderStats()),
    };
  }
  const system = await page.evaluate(() => {
    const gl = document.querySelector("canvas")?.getContext("webgl2");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    return {
      userAgent: navigator.userAgent,
      renderer: info && gl ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "not exposed",
    };
  });
  const ordered = Object.fromEntries(Object.entries(perf).map(([quality, result]) => {
    const render = result.render;
    return [quality, {
      samples: result.frames,
      averageFrameMs: result.avgMs,
      averageFps: Number(result.avgFps.toFixed(1)),
      p99FrameMs: result.p99Ms,
      onePercentLowFps: result.onePercentLowFps,
      minFps: result.minFps,
      fullScenery: result.fullScenery,
      renderer: {
        calls: render.calls,
        triangles: render.triangles,
        geometries: render.geometries,
        textures: render.textures,
        programs: render.programs,
        dressingVisible: render.dressingVisible,
        sceneGeometries: render.sceneGeometries,
        sceneTextures: render.sceneTextures,
      },
    }];
  }));
  const performanceReport = {
    captureDate: new Date().toISOString(),
    environment: `Playwright headed Chromium, ${system.renderer}`,
    userAgent: system.userAgent,
    viewport: `${page.viewportSize()?.width}x${page.viewportSize()?.height}`,
    active: {
      phase: await evalRetry(() => window.__controlsTest.phase()),
      cars: await evalRetry(() => window.__controlsTest.carCount()),
      renderer: system.renderer,
    },
    results: ordered,
    errors: consoleErrors,
  };
  const performancePath = checkedOutputPath(join(outDir, "performance.json"), outputRoots());
  writeFileSync(performancePath, JSON.stringify(performanceReport, null, 2));
  console.log(`wrote ${performancePath}`);
}

writeImageChecks();
console.log(`wrote ${checkPath}`);
console.log(JSON.stringify({ ok: consoleErrors.length === 0 && imageChecks.every((check) => check.pass), consoleErrors, outDir, imageChecks, transitionMemory, perf }, null, 2));
await browser.close();
