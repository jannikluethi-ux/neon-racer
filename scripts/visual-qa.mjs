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
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const TRACKS = ["apex", "nightfall", "velocity", "overdrive"];
const CARS = ["vector", "vanta", "surge", "aegis"];
const VIEWS = {
  front: { angle: 0, dist: 7, height: 1.5, look: 0.55, fov: 42 },
  side: { angle: Math.PI / 2, dist: 7.6, height: 1.35, look: 0.6, fov: 42 },
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
    prefix: "recon",
    race: false,
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
const outDir = join(process.cwd(), "screenshots", args.prefix);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const consoleErrors = [];
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
  const path = join(outDir, `${name}.png`);
  await page.screenshot({ path });
  console.log(`wrote ${path}`);
};

await page.goto(args.url, { waitUntil: "networkidle" });
await settleContext();

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

if (args.race) {
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

console.log(JSON.stringify({ ok: consoleErrors.length === 0, consoleErrors, outDir }, null, 2));
await browser.close();
