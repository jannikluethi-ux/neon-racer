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
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { checkedOutputPath, outputRoots, repoRoot } from "./browser-guard.mjs";

const TRACKS = ["apex", "nightfall", "velocity", "overdrive"];
const CARS = ["vector", "vanta", "surge", "aegis"];
const VIEWS = {
  front: { angle: 0, dist: 7, height: 1.5, look: 0.55, fov: 42 },
  side: { angle: Math.PI / 2, dist: 7.6, height: 1.35, look: 0.6, fov: 42 },
  sideHigh: { angle: Math.PI / 2, dist: 9.2, height: 2.4, look: 0.7, fov: 42 },
  rear: { angle: Math.PI, dist: 7, height: 1.55, look: 0.6, fov: 42 },
  qfront: { angle: 0.72, dist: 7.4, height: 1.7, look: 0.6, fov: 45 },
  qrear: { angle: Math.PI - 0.72, dist: 7.8, height: 1.9, look: 0.6, fov: 45 },
  chase: { angle: Math.PI, dist: 8.6, height: 2.75, look: 1.0, fov: 60 },
  low: { angle: Math.PI - 0.5, dist: 6.4, height: 0.75, look: 0.5, fov: 45 },
  df: { angle: 0.5, dist: 3.1, height: 0.7, look: 0.5, fov: 40 },
  dr: { angle: Math.PI - 0.55, dist: 3.2, height: 0.8, look: 0.5, fov: 40 },
  dw: { angle: Math.PI / 2, dist: 3.6, height: 0.55, look: 0.4, fov: 40 },
  wheel: { angle: Math.PI / 2 + 0.5, dist: 3.0, height: 0.5, look: 0.38, fov: 36 },
};

function parseFlags(argv) {
  const out = {
    tracks: TRACKS,
    cars: CARS,
    views: Object.keys(VIEWS),
    prefix: "recon-2.1",
    race: false,
    set: "",
    perf: false,
    headed: false,
    url: "http://127.0.0.1:8080/?qa=1",
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
    else if (a === "--perf") out.perf = true;
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

const shot = async (name) => {
  // Screens remount on every navigation, so re-hide right before the capture.
  await evalRetry(HIDE_UI);
  await settle(90);
  const path = checkedOutputPath(join(outDir, `${name}.png`), outputRoots());
  await page.screenshot({ path });
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
  await setInspect({ car: 0, ...VIEWS[view], freeze: true });
  await settle(280);
  await shot(name);
}

async function contactShot(name, spec) {
  await evalRetry(() => window.__controlsTest.clearInspect());
  await evalRetry((s) => window.__controlsTest.placeAt(s.arc, s.lat), spec);
  await settle(250);
  await setInspect({ car: 0, angle: spec.angle ?? Math.PI / 2, dist: spec.dist ?? 6.2, height: spec.height ?? 1.15, look: 0.45, fov: 42, freeze: true });
  await settle(280);
  await shot(name);
}

if (args.set === "recon21") {
  await park("apex", "vector", "qfront", "vector-qfront");
  await park("apex", "vector", "side", "vector-side");
  await park("apex", "vanta", "qfront", "vanta-qfront");
  await park("apex", "surge", "side", "surge-side");
  await park("apex", "aegis", "qfront", "aegis-qfront");
  await park("apex", "vector", "wheel", "vector-wheel");
  await park("apex", "vector", "low", "asphalt-close");
  await park("apex", "vector", "chase", "barrier-chase");

  await toTitle();
  await ensurePicker("Tracks");
  if (!(await clickCard(TRACKS.indexOf("nightfall")))) throw new Error("nightfall missing");
  await settle(800);
  await toTitle();
  const probe = await evalRetry(() => window.__controlsTest.trackProbe());
  const kerbLat = Math.max(0, probe.half - 0.4);
  await contactShot("kerb-straight", { arc: 40, lat: probe.half - 0.5, angle: Math.PI / 2, height: 0.7, dist: 4.2 });
  await contactShot("kerb-curve", { arc: probe.kerb, lat: probe.half - 0.45, angle: 0.4, height: 0.8, dist: 4.6 });

  // Run the same road-contact cases with each authored vehicle selected in the
  // live application, so the wheel layout and the rendered wheel assemblies
  // stay in the loop for these captures.
  for (const [carIndex, car] of CARS.entries()) {
    await toTitle();
    await ensurePicker("Cars");
    if (!(await clickCard(carIndex))) throw new Error(`car card missing: ${car}`);
    await settle(700);
    await toTitle();
    const suffix = carIndex === 0 ? "" : `-${car}`;
    const contact = (name, spec) => contactShot(`contact${suffix}-${name}`, spec);
    await contact("flat", { arc: 30, lat: 0, angle: Math.PI / 2, height: 1.1 });
    await contact("uphill", { arc: probe.uphill, lat: 0, angle: Math.PI / 2, height: 1.2 });
    await contact("downhill", { arc: probe.downhill, lat: 0, angle: Math.PI / 2, height: 1.2 });
    await contact("crest", { arc: probe.crest, lat: 0, angle: Math.PI / 2 + 0.4, height: 1.3 });
    await contact("road-transition", { arc: probe.transition, lat: 0, angle: 0.9, height: 1.15 });
    await contact("kerb-left", { arc: probe.kerb, lat: -kerbLat, angle: -Math.PI / 2, height: 0.9, dist: 5.4 });
    await contact("kerb-right", { arc: probe.kerb, lat: kerbLat, angle: Math.PI / 2, height: 0.9, dist: 5.4 });
    await contact("kerb-gradient", { arc: probe.kerbGradient, lat: kerbLat, angle: 0.4, height: 0.9, dist: 5.4 });
    await contact("kerb-transition", { arc: probe.kerb + 12, lat: kerbLat * 0.45, angle: 0.9, height: 1.05, dist: 6 });
  }

  for (const track of TRACKS) {
    await toTitle();
    await ensurePicker("Tracks");
    if (!(await clickCard(TRACKS.indexOf(track)))) throw new Error(track);
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
    await page.keyboard.down("KeyW");
    await wait(1800);
    await shot(`race-${track}`);
    transitionMemory.push({ track, ...(await evalRetry(() => window.__controlsTest.renderStats())) });
    await page.keyboard.up("KeyW");
    await clickButton("Quit").catch(() => {});
    await settle(400);
  }
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
      await setInspect({ car: 0, ...VIEWS[view], freeze: true });
      await settle(230);
      await shot(`${track}-${car}-${view}`);
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

console.log(JSON.stringify({ ok: consoleErrors.length === 0, consoleErrors, outDir, transitionMemory, perf }, null, 2));
await browser.close();
