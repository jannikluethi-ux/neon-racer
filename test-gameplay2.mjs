import { chromium } from "playwright";

const browser = await chromium.launch({ headless: false, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

const errors = [];
page.on("console", msg => {
  if (msg.type() === "error") errors.push(msg.text());
});
page.on("pageerror", err => errors.push(err.message));

await page.goto("http://127.0.0.1:8080", { waitUntil: "networkidle" });
await page.waitForTimeout(3000);

// Test cars menu
await page.click("button:has-text('Cars')");
await page.waitForTimeout(1500);
await page.screenshot({ path: "/Users/janniksmacbookair/Library/Mobile Documents/com~apple~CloudDocs/Projects/Builder Apps/Neon Racer/screenshots/cars-menu.png" });

// Get all button texts
const buttons = await page.$$eval("button", els => els.map(e => e.textContent?.trim()));
console.log("Buttons on cars screen:", buttons);

// Back to title - try different texts
for (const text of ["Done", "Back", "Menu", "Close"]) {
  const btn = page.locator(`button:has-text('${text}')`).first();
  if (await btn.count() > 0) {
    await btn.click();
    break;
  }
}
await page.waitForTimeout(1000);

// Test tracks menu
await page.click("button:has-text('Tracks')");
await page.waitForTimeout(1500);
await page.screenshot({ path: "/Users/janniksmacbookair/Library/Mobile Documents/com~apple~CloudDocs/Projects/Builder Apps/Neon Racer/screenshots/tracks-menu.png" });

const buttons2 = await page.$$eval("button", els => els.map(e => e.textContent?.trim()));
console.log("Buttons on tracks screen:", buttons2);

console.log("Console errors:", errors);
await browser.close();
