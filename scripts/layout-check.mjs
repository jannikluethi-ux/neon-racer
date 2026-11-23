#!/usr/bin/env node
/**
 * Browser layout check for the touch race HUD and the garage picker.
 * Renders the real game in headless Chromium and fails if:
 *  - a touch pad or the steering wheel overlaps the lap / time / split text,
 *    the position block, the speedometer or the minimap, or a control is not
 *    the element hit at its centre;
 *  - GAS sits closer than 12 px (beyond the safe-area inset) to the bottom edge;
 *  - the garage info panel or the arrows cover the selected car, or the panel
 *    covers a neighbouring car (short landscape and portrait).
 *
 * Needs a running dev server (the dev-only __controlsTest hook):
 *   npm run dev   # then
 *   node scripts/layout-check.mjs [http://127.0.0.1:8080] [--views=915x412,844x390]
 * Slow under software GL (a few minutes per viewport); not part of CI.
 */
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";

const args = process.argv.slice(2);
const base = checkedUrl(args.find((a) => !a.startsWith("--")) || "http://127.0.0.1:8080").replace(/\/$/, "");
const viewArg = args.find((a) => a.startsWith("--views="))?.slice(8);
const ALL = {
  "915x412": { width: 915, height: 412 },
  "844x390": { width: 844, height: 390 },
  "720x1280": { width: 720, height: 1280 },
  "1280x720": { width: 1280, height: 720 },
};
const tags = viewArg ? viewArg.split(",") : ["915x412", "844x390"];
const MIN_EDGE = 12;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const overlap = (a, b) => {
  if (!a || !b) return 0;
  const w = Math.min(a.r, b.r) - Math.max(a.x, b.x);
  const h = Math.min(a.b, b.b) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? Math.round(w * h) : 0;
};

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const failures = [];
const fail = (msg) => failures.push(msg);

async function open(size) {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem("neon-racer-intro-seen", "1"));
  page.on("pageerror", (e) => fail(`page error: ${e.message}`));
  await page.goto(`${base}/?qa=1&unlock=1`);
  await page.waitForFunction(() => Boolean(window.__controlsTest), null, { timeout: 60000 });
  await wait(2000);
  await page.getByRole("button", { name: /^race$/i }).first().click();
  return { context, page };
}

async function settledBoxes(page) {
  let prev = "";
  for (let i = 0; i < 40; i++) {
    const st = await page.evaluate(() => ({
      focus: document.querySelector(".picker")?.getAttribute("data-focus"),
      boxes: window.__controlsTest?.showroomBoxes?.() ?? [],
    }));
    const key = JSON.stringify(st.boxes.map((b) => [b.id, b.focus, Math.round(b.x), Math.round(b.y), Math.round(b.width)]));
    if (key === prev && st.boxes.some((b) => b.focus && b.id === st.focus)) return st;
    prev = key;
    await wait(700);
  }
  return null;
}

for (const tag of tags) {
  const size = ALL[tag];
  if (!size) throw new Error(`unknown view ${tag}`);
  // Garage
  {
    const { context, page } = await open(size);
    for (let i = 0; i < 4; i++) {
      const st = await settledBoxes(page);
      if (!st) fail(`${tag} garage: carousel never settled`);
      const ui = await page.evaluate(() => {
        const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return b.width || b.height ? { x: b.x, y: b.y, r: b.right, b: b.bottom } : null; };
        const q = (s) => r(document.querySelector(s));
        return { layout: document.querySelector(".picker")?.getAttribute("data-layout"), copy: q(".dock-copy"), stats: q(".dock-stats"), actions: q(".picker-actions"), chevL: q(".chev-left"), chevR: q(".chev-right") };
      });
      for (const b of st?.boxes ?? []) {
        const box = { x: b.x, y: b.y, r: b.x + b.width, b: b.y + b.height };
        // The wide desktop dock sits under the cars by design; check the
        // layouts this pass is responsible for.
        if (ui.layout === "dock") continue;
        for (const part of ["copy", "stats", "actions"]) {
          const a = overlap(box, ui[part]);
          if (a > 0.02 * b.width * b.height) fail(`${tag} garage ${st.focus}: panel ${part} covers ${b.focus ? "selected" : "neighbour"} car ${b.id} (${a} px²)`);
        }
        if (b.focus) {
          if (overlap(box, ui.chevL) || overlap(box, ui.chevR)) fail(`${tag} garage: an arrow covers the selected car ${b.id}`);
          if (box.x < 0 || box.r > size.width || box.y < 0 || box.b > size.height) fail(`${tag} garage: selected car ${b.id} is cut off by the screen edge`);
        }
      }
      await page.getByRole("button", { name: "Next car" }).click();
    }
    await context.close();
  }
  // Race HUD
  if (size.width > size.height) {
    const { context, page } = await open(size);
    await wait(2500);
    await page.getByRole("button", { name: /next — track/i }).first().click();
    await wait(2000);
    await page.getByRole("button", { name: /start race/i }).first().click();
    await page.waitForFunction(() => window.__controlsTest?.phase?.() === "racing", null, { timeout: 90000 });
    await wait(1500);
    const m = await page.evaluate(() => {
      const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return b.width || b.height ? { x: b.x, y: b.y, r: b.right, b: b.bottom } : null; };
      const q = (s) => r(document.querySelector(s));
      const text = [...document.querySelectorAll(".hud-right p")].map((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const b = range.getBoundingClientRect();
        return { name: el.textContent.trim(), x: b.x, y: b.y, r: b.right, b: b.bottom };
      });
      const probe = document.createElement("div");
      probe.style.cssText = "position:fixed;padding-bottom:env(safe-area-inset-bottom)";
      document.body.appendChild(probe);
      const inset = parseFloat(getComputedStyle(probe).paddingBottom) || 0;
      probe.remove();
      return {
        inset,
        text,
        hud: { position: q(".hud-position"), speedometer: q(".speedometer"), minimap: q(".minimap") },
        controls: { nitro: q(".pad.boost"), drift: q(".pad.drift"), brake: q(".pad.brake"), gas: q(".pad.gas"), wheel: q(".steering-wheel") },
      };
    });
    const important = [...m.text.map((t) => [t.name, t]), ...Object.entries(m.hud)];
    for (const [cn, c] of Object.entries(m.controls)) {
      if (!c) { fail(`${tag} race: ${cn} control missing`); continue; }
      for (const [hn, h] of important) if (overlap(c, h)) fail(`${tag} race: ${cn} overlaps "${hn}"`);
    }
    // Every control must be the element a finger hits at its centre.
    const blocked = await page.evaluate(() =>
      [".pad.boost", ".pad.drift", ".pad.brake", ".pad.gas", ".steering-wheel"].filter((sel) => {
        const el = document.querySelector(sel);
        if (!el) return true;
        const b = el.getBoundingClientRect();
        const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
        return !hit || !el.contains(hit);
      }),
    );
    for (const sel of blocked) fail(`${tag} race: ${sel} is not tappable at its centre`);
    const gas = m.controls.gas;
    if (gas && size.height - gas.b - m.inset < MIN_EDGE) fail(`${tag} race: GAS is ${(size.height - gas.b - m.inset).toFixed(1)} px from the bottom edge beyond the safe area (min ${MIN_EDGE})`);
    await context.close();
  }
  console.log(`${tag} checked`);
}
await browser.close();
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("layout-check ok");
