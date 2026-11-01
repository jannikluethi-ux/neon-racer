import { chromium } from "playwright";

const browser = await chromium.launch({ headless: false, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const errors = [];
page.on("console", msg => {
  if (msg.type() === "error") errors.push(msg.text());
});
page.on("pageerror", err => errors.push(err.message));

await page.goto("http://127.0.0.1:8080", { waitUntil: "networkidle" });
await page.waitForTimeout(2000);

// Check if canvas is rendered
const canvas = await page.$("canvas.game-canvas");
console.log("Canvas found:", !!canvas);

// Start a race - click Race button
await page.click("button:has-text('Race')");
await page.waitForTimeout(500);

// Click track to start
await page.click("button:has-text('Start race')");
await page.waitForTimeout(3000);

// Take screenshot during race
await page.screenshot({ path: "/Users/janniksmacbookair/Library/Mobile Documents/com~apple~CloudDocs/Projects/Builder Apps/Neon Racer/screenshots/race.png" });

// Test steering - hold A key
await page.keyboard.down("KeyA");
await page.waitForTimeout(1000);
await page.keyboard.up("KeyA");
await page.waitForTimeout(500);

// Test D key
await page.keyboard.down("KeyD");
await page.waitForTimeout(1000);
await page.keyboard.up("KeyD");

await page.screenshot({ path: "/Users/janniksmacbookair/Library/Mobile Documents/com~apple~CloudDocs/Projects/Builder Apps/Neon Racer/screenshots/race-steer.png" });

console.log("Console errors:", errors);
await browser.close();
