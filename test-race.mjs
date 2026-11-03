import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { checkedOutputPath, outputRoots, repoRoot } from "./scripts/browser-guard.mjs";

const screenshotDir = join(repoRoot(), "screenshots");
mkdirSync(screenshotDir, { recursive: true });
const screenshotPath = (name) => checkedOutputPath(join(screenshotDir, name), outputRoots());

const browser = await chromium.launch({ headless: false, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

const errors = [];
page.on("console", msg => {
  if (msg.type() === "error") errors.push(msg.text());
});
page.on("pageerror", err => errors.push(err.message));

await page.goto("http://127.0.0.1:8080", { waitUntil: "networkidle" });
await page.waitForTimeout(3000);

// Start race flow - Race -> Cars -> Tracks -> Start
await page.click("button:has-text('Race')");
await page.waitForTimeout(2000);

// Car selection - click "Next — track"
await page.click("button:has-text('Next — track')");
await page.waitForTimeout(2000);

// Track selection - click "Start race"
await page.click("button:has-text('Start race')");
await page.waitForTimeout(6000); // Wait for countdown and race start

await page.screenshot({ path: screenshotPath("race-early.png") });

// Drive for a bit
await page.keyboard.down("KeyW"); // Gas
await page.waitForTimeout(3000);
await page.screenshot({ path: screenshotPath("race-driving.png") });

// Test steering
await page.keyboard.down("KeyA");
await page.waitForTimeout(1500);
await page.keyboard.up("KeyA");
await page.waitForTimeout(1000);

await page.keyboard.down("KeyD");
await page.waitForTimeout(1500);
await page.keyboard.up("KeyD");
await page.waitForTimeout(1000);

await page.screenshot({ path: screenshotPath("race-steering.png") });

// Test nitro
await page.keyboard.down("Space");
await page.waitForTimeout(1000);
await page.keyboard.up("Space");
await page.waitForTimeout(1000);

await page.screenshot({ path: screenshotPath("race-nitro.png") });

// Release gas, test brake
await page.keyboard.up("KeyW");
await page.keyboard.down("KeyS");
await page.waitForTimeout(1000);
await page.keyboard.up("KeyS");

await page.screenshot({ path: screenshotPath("race-brake.png") });

// Complete a lap - keep driving
await page.keyboard.down("KeyW");
await page.waitForTimeout(15000);
await page.screenshot({ path: screenshotPath("race-lap.png") });
await page.keyboard.up("KeyW");

console.log("Console errors:", errors);
await browser.close();
