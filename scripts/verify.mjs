// Browser check: loads the app at phone and desktop widths, drives the main flows,
// saves screenshots to docs/screenshots and fails on console errors or failed requests.
// Usage: npm run build && npx next start -p 3210, then: node scripts/verify.mjs [baseUrl]
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://localhost:3210";
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? "msedge", args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const problems = [];

for (const [name, width, height] of [["desktop-1440", 1440, 900], ["mobile-375", 375, 812]]) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on("console", (m) => m.type() === "error" && problems.push(`${name} console: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`${name} pageerror: ${e.message}`));
  page.on("response", (r) => r.status() >= 400 && problems.push(`${name} ${r.status()} ${r.url()}`));
  const shot = (step) => page.screenshot({ path: `docs/screenshots/${name}-${step}.png` });

  await page.goto(base);
  await page.getByRole("heading", { name: "Sentinel Earth" }).waitFor();
  const firstEvent = page.locator("li > button[aria-expanded]").first();
  await firstEvent.waitFor({ timeout: 30_000 });
  await page.waitForTimeout(9000); // intro fly-in and imagery tiles
  await shot("1-overview");

  await firstEvent.click();
  await page.getByRole("button", { name: "See that day's imagery" }).click();
  await page.waitForTimeout(6000);
  assert.match(page.url(), /event=EONET_\d+/, "selected event is in the shareable link");
  await shot("2-event");

  await page.getByRole("tab", { name: "Asteroids" }).click();
  await page.getByRole("button", { name: "Show them around Earth" }).click();
  await page.waitForTimeout(5000);
  assert.match(page.url(), /view=space/);
  assert.ok((await page.locator("svg circle").count()) > 0, "asteroid chart has data");
  await shot("3-asteroids");

  await page.getByRole("tab", { name: "Analyst" }).click();
  await page.getByRole("textbox").fill("Which asteroid passes closest in the next 30 days?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.waitForTimeout(process.env.ANTHROPIC_CHECK ? 25_000 : 2500);
  await shot("4-analyst");

  await page.getByRole("tab", { name: "About" }).click();
  await shot("5-about");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `${name}: page scrolls sideways by ${overflow}px`);
  await page.close();
}

await browser.close();
// Without a key the analyst route answers 503 by design; that is the only tolerated failure.
const real = problems.filter((p) => process.env.ANTHROPIC_CHECK || !/503|api\/analyst/.test(p));
console.log(real.length ? real.join("\n") : "No console errors or failed requests.");
process.exit(real.length ? 1 : 0);
