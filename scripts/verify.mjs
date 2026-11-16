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

  // First visit: the intro shows live counts and keeps the console out of the way until it is dismissed.
  const intro = page.getByRole("region", { name: "Welcome" });
  await intro.waitFor();
  await page.waitForFunction(
    () => /\d+ natural events are open right now, and \d+ asteroids pass within 20 lunar distances/.test(document.querySelector("[data-testid=intro-fact]")?.textContent ?? ""),
    null,
    { timeout: 30_000 },
  );
  assert.equal(await rows.first().isVisible(), false, "the console is hidden behind the intro");
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Open the console", "focus starts on the intro button");
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("[data-intro] h1")).animationName), "intro-rise", "the entrance animates with normal motion");
  await page.waitForTimeout(9000); // fly-in and imagery tiles behind the panel
  await shot("0-intro");
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0, `${name}: intro scrolls sideways`);
  await page.getByRole("button", { name: "Open the console" }).click();
  await intro.waitFor({ state: "detached" });
  await rows.first().waitFor({ timeout: 30_000 });
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

  // Night side off and density on both leave the page healthy. On a phone these tools start folded away.
  const tools = page.getByRole("button", { name: "Date and tools" });
  if (await tools.isVisible()) await tools.click();
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
  await page.waitForFunction((img) => img.complete && img.naturalWidth > 0, await earth.elementHandle(), { timeout: 60_000 }); // the EPIC archive can take a while on a cold fetch
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

  // Ground view: G enters, the HUD shows computed values, arrows turn, Esc returns the camera to where it was.
  await page.waitForTimeout(2500); // let the globe finish flying to the event
  await page.keyboard.press("g");
  await page.waitForURL(/view=ground/);
  const title = page.getByTestId("ground-title");
  await title.waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Exit ground view", "focus moves to the exit button");
  assert.match(await page.getByTestId("ground-solar").innerText(), /^\d\d:\d\d$/, "local solar time renders");
  assert.match(await page.getByTestId("ground-sun").innerText(), /^\d+° (above|below) the horizon/, "sun elevation renders");
  await page.waitForTimeout(3500);
  await shot("9-ground");
  const facing = page.getByText(/^Facing /);
  const before = await facing.innerText();
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(300);
  assert.notEqual(await facing.innerText(), before, "arrow keys turn the view");
  assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0, `${name}: ground view scrolls sideways`);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !location.search.includes("view=ground"));
  const host = page.locator("[data-pov-after]");
  await host.waitFor({ state: "attached", timeout: 5000 });
  const [was, now] = await Promise.all(["data-pov-before", "data-pov-after"].map(async (a) => JSON.parse(await host.getAttribute(a))));
  assert.ok(Math.abs(was.lat - now.lat) < 0.5 && Math.abs(was.lng - now.lng) < 0.5 && Math.abs(was.altitude - now.altitude) < 0.05, `camera restored: ${JSON.stringify(was)} vs ${JSON.stringify(now)}`);
  await page.close();

  // Every event, with motion reduced so each move is an instant cut. Starts from a shared link to the
  // highest-latitude event, then steps with ] until it has visited them all.
  const calm = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
  calm.on("console", (m) => m.type() === "error" && problems.push(`${name} calm console: ${m.text()}`));
  calm.on("pageerror", (e) => problems.push(`${name} calm pageerror: ${e.message}`));
  calm.on("response", (r) => r.status() >= 400 && problems.push(`${name} calm ${r.status()} ${r.url()}`));
  const events = (await (await calm.request.get(`${base}/api/events`)).json()).items;
  const polar = events.reduce((a, e) => (Math.abs(e.lat) > Math.abs(a.lat) ? e : a));
  await calm.goto(`${base}/?view=ground&event=${polar.id}`);
  const calmTitle = calm.getByTestId("ground-title");
  await calmTitle.waitFor({ timeout: 30_000 });
  // Visible text collapses runs of spaces, and some NASA titles contain them.
  const same = (a, b) => assert.equal(a.replace(/\s+/g, " ").trim(), (b ?? "").replace(/\s+/g, " ").trim());
  same(await calmTitle.innerText(), polar.title); // a shared ground-view link opens that event
  const seen = new Set([polar.id]);
  for (let i = 1; i < events.length; i++) {
    const id = new URL(calm.url()).searchParams.get("event");
    await calm.keyboard.press("]");
    await calm.waitForFunction((prev) => new URLSearchParams(location.search).get("event") !== prev, id, { timeout: 5000 });
    const next = new URL(calm.url()).searchParams.get("event");
    same(await calmTitle.innerText(), events.find((e) => e.id === next)?.title);
    seen.add(next);
    await calm.waitForTimeout(400); // gentle on NASA's tile servers
  }
  assert.equal(seen.size, events.length, `visited ${seen.size} of ${events.length} events`);

  // A link to an event that has closed falls back to the globe and says so.
  await calm.goto(`${base}/?view=ground&event=EONET_0`);
  await calm.getByText("The event in that link is no longer open").waitFor({ timeout: 30_000 });
  assert.equal(await calm.getByRole("region", { name: "Welcome" }).count(), 0, "a shared link skips the intro");
  await calm.close();

  // The intro: Enter and Esc each open the console, it stays gone after a reload, an event link skips it,
  // and with motion reduced it is still and fully visible.
  const watch = (p, tag) => {
    p.on("console", (m) => m.type() === "error" && problems.push(`${name} ${tag} console: ${m.text()}`));
    p.on("pageerror", (e) => problems.push(`${name} ${tag} pageerror: ${e.message}`));
    p.on("response", (r) => r.status() >= 400 && problems.push(`${name} ${tag} ${r.status()} ${r.url()}`));
  };
  for (const key of ["Enter", "Escape"]) {
    const p = await browser.newPage({ viewport: { width, height } });
    watch(p, key);
    await p.goto(base);
    const welcome = p.getByRole("region", { name: "Welcome" });
    await welcome.waitFor();
    await p.keyboard.press(key);
    await welcome.waitFor({ state: "detached" });
    await p.getByText("Drag to rotate. Click a marker for details.").waitFor(); // the hint follows the intro
    await p.reload();
    await p.locator("li > button[aria-expanded]").first().waitFor({ timeout: 30_000 });
    assert.equal(await p.getByRole("region", { name: "Welcome" }).count(), 0, `the intro stays gone after ${key} and a reload`);
    await p.close();
  }
  const linked = await browser.newPage({ viewport: { width, height } });
  watch(linked, "event link");
  await linked.goto(`${base}/?event=${polar.id}`);
  await linked.getByRole("heading", { name: "Sentinel Earth" }).waitFor();
  assert.equal(await linked.getByRole("region", { name: "Welcome" }).count(), 0, "a link with an event skips the intro");
  await linked.close();
  const still = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
  watch(still, "reduced motion");
  await still.goto(base);
  await still.getByRole("region", { name: "Welcome" }).waitFor();
  assert.deepEqual(await still.evaluate(() => { const c = getComputedStyle(document.querySelector("[data-intro] h1")); return [c.animationName, c.opacity]; }), ["none", "1"], "the intro is still and fully visible when motion is reduced");
  await still.close();
}

await browser.close();

// Two failures are expected and do not fail the check:
// - the analyst route answers 503 by design when there is no ANTHROPIC_API_KEY;
// - a NASA GIBS imagery tile that fails: a 404 when it has no data for that day (orbit gaps, days still
//   being processed), or an error with no CORS header when GIBS is busy, which the browser reports as a
//   CORS block. The ground view asks for many close-up tiles, so it meets these; the app shows the day
//   before or the Blue Marble there instead. The browser also logs one generic line per failed tile.
// Everything else fails: any request to this app, any other host or status, any other console message.
let analyst = 0, noTile = 0;
const rest = problems.filter((p) => {
  if (!process.env.ANTHROPIC_CHECK && /503|api\/analyst/.test(p)) return !++analyst;
  const tile404 = / 404 https:\/\/gibs\.earthdata\.nasa\.gov\/wmts\/.+\.(jpe?g|png)$/.test(p);
  const tileCors = /console: Access to image at 'https:\/\/gibs\.earthdata\.nasa\.gov\/wmts\/[^']+\.(jpe?g|png)' from origin .* blocked by CORS policy/.test(p);
  return tile404 || tileCors ? !++noTile : true;
});
// Pair each tolerated tile failure with the one generic console line the browser writes for it.
let pairs = noTile;
const real = rest.filter((p) => !(pairs > 0 && /console: Failed to load resource: (the server responded with a status of 404|net::ERR_FAILED)/.test(p) && pairs--));
if (noTile) console.log(`${noTile} NASA imagery tile requests failed (no data for the day, or GIBS busy); the app fell back to other imagery.`);
console.log(real.length ? real.join("\n") : "No console errors or failed requests.");
process.exit(real.length ? 1 : 0);
