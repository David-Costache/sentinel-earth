// Quick look: node scripts/shot.mjs <url> <out.png> [width] [height] [waitMs]
import { chromium } from "playwright-core";

const [url, out, w = "1440", h = "900", wait = "9000"] = process.argv.slice(2);
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? "msedge", args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on("console", (m) => m.type() === "error" && console.log("console:", m.text().slice(0, 300)));
page.on("pageerror", (e) => console.log("pageerror:", e.message));
page.on("response", (r) => r.status() >= 400 && console.log(r.status(), r.url()));
await page.goto(url);
await page.waitForTimeout(+wait);
await page.screenshot({ path: out });
await browser.close();
