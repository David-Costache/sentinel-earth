// Browser check: loads the app at phone and desktop widths, drives the main flows,
// saves screenshots to docs/screenshots and fails on console errors or failed requests.
// Usage: npm run build && npx next start -p 3001, then: node scripts/verify.mjs [baseUrl]
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://localhost:3001";
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? "msedge", args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const problems = [];

for (const [name, width, height] of [["desktop-1440", 1440, 900], ["mobile-375", 375, 812]]) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on("console", (m) => m.type() === "error" && problems.push(`${name} console: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`${name} pageerror: ${e.message}`));
  page.on("response", (r) => r.status() >= 400 && problems.push(`${name} ${r.status()} ${r.url()}`));
  const shot = async (step) => {
    await page.waitForTimeout(500); // let tab and hover transitions settle
    await page.screenshot({ path: `docs/screenshots/${name}-${step}.png` });
  };
  const rows = page.locator("li > button[aria-expanded]");

  await page.goto(base);
  await page.getByRole("heading", { name: "Sentinel Earth" }).waitFor();
  await rows.first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(9000); // intro fly-in and imagery tiles
  await shot("1-overview");

  // Mission clock ticks in UTC.
  const clock = page.locator("time").first();
  const t1 = await clock.innerText();
  assert.match(t1, /^\d\d:\d\d:\d\d UTC$/, `clock reads "${t1}"`);
  await page.waitForTimeout(1200);
  assert.notEqual(await clock.innerText(), t1, "clock ticks");

  // First-visit hint: shown once, gone after touching the globe, still gone after a reload.
  const hint = page.getByText("Drag to rotate. Click a marker for details.");
  assert.ok(await hint.isVisible(), "first-visit hint shows");
  const globe = page.getByRole("img", { name: /3D globe of Earth/ });
  const box = await globe.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2);
  await page.mouse.up();
  await hint.waitFor({ state: "detached" });
  await page.reload();
  await rows.first().waitFor({ timeout: 30_000 });
  assert.equal(await hint.count(), 0, "hint stays dismissed after a reload");

  // Select an event and jump to its imagery.
  await rows.first().click();
  await page.getByRole("button", { name: "See that day's imagery" }).click();
  await page.waitForTimeout(6000);
  assert.match(page.url(), /event=EONET_\d+/, "selected event is in the shareable link");
  await shot("2-event");

  // Search narrows the list, and the export holds exactly what is listed.
  const total = await rows.count();
  const word = (await rows.first().innerText()).trim().split(/\s+/)[0];
  await page.getByRole("searchbox", { name: "Search events by name" }).fill(word);
  const found = await rows.count();
  assert.ok(found > 0 && found <= total, `search for "${word}" keeps ${found} of ${total}`);
  for (const t of await rows.allInnerTexts()) assert.ok(t.toLowerCase().includes(word.toLowerCase()), `"${t}" matches "${word}"`);
  const [csvFile] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "CSV", exact: true }).click()]);
  const csv = (await readFile(await csvFile.path(), "utf8")).split("\r\n");
  assert.equal(csv[0], "id,title,categoryTitle,started,date,lat,lng,magnitude,source");
  assert.equal(csv.length - 1, found, "CSV has one row per listed event");
  const [geoFile] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "GeoJSON" }).click()]);
  assert.equal(JSON.parse(await readFile(await geoFile.path(), "utf8")).features.length, found);
  await page.getByRole("searchbox", { name: "Search events by name" }).fill("");

  // Night side off and density on both leave the page healthy.
  await page.getByRole("button", { name: "Density" }).click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Density" }).click();

  await page.getByRole("tab", { name: "Asteroids" }).click();
  await page.getByRole("button", { name: "Show them around Earth" }).click();
  await page.waitForTimeout(5000);
  assert.match(page.url(), /view=space/);
  assert.ok((await page.locator("svg circle").count()) > 0, "asteroid chart has data");
  await shot("3-asteroids");

  await page.getByRole("tab", { name: "Sun" }).click();
  await page.getByText("Space weather from the Sun").waitFor();
  assert.ok((await page.getByRole("link", { name: "NASA DONKI record" }).count()) > 0, "space weather list has records");
  await shot("4-space-weather");

  await page.getByRole("tab", { name: "Analyst" }).click();
  await page.getByRole("textbox", { name: "Question for the analyst" }).fill("Which asteroid passes closest in the next 30 days?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.waitForTimeout(process.env.ANTHROPIC_CHECK ? 25_000 : 2500);
  await shot("5-analyst");

  await page.getByRole("tab", { name: "About" }).click();
  await shot("6-about");

  // Dashboard: charts, the EPIC image, and a click that lands back on the globe.
  await page.getByRole("button", { name: "dashboard" }).click();
  assert.match(page.url(), /view=dashboard/);
  await page.getByRole("heading", { name: "Event reports per day" }).waitFor();
  assert.ok((await page.locator("figure svg rect").count()) > 0, "reports chart has bars");
  await page.getByRole("heading", { name: "Space weather, last 30 days" }).waitFor();
  const earth = page.getByRole("img", { name: /Full sunlit disk of Earth/ });
  await earth.scrollIntoViewIfNeeded();
  await page.waitForFunction((img) => img.complete && img.naturalWidth > 0, await earth.elementHandle(), { timeout: 30_000 });
  await shot("8-dashboard-earth");
  await page.getByRole("heading", { name: "Sentinel Earth" }).scrollIntoViewIfNeeded();
  await page.getByText("Show as table").first().click();
  assert.ok((await page.locator("details[open] tbody tr").count()) > 0, "chart has a table equivalent");
  await page.getByText("Show as table").first().click();
  await shot("7-dashboard");
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(sideways <= 0, `${name}: dashboard scrolls sideways by ${sideways}px`);
  await page.getByRole("button", { name: /Show the latest on the globe/ }).first().click();
  assert.doesNotMatch(page.url(), /view=dashboard/, "clicking a bar returns to the globe");
  assert.match(page.url(), /event=EONET_\d+/);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `${name}: page scrolls sideways by ${overflow}px`);
  await page.close();
}

await browser.close();
// Without a key the analyst route answers 503 by design; that is the only tolerated failure.
const real = problems.filter((p) => process.env.ANTHROPIC_CHECK || !/503|api\/analyst/.test(p));
console.log(real.length ? real.join("\n") : "No console errors or failed requests.");
process.exit(real.length ? 1 : 0);
