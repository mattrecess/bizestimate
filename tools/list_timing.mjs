// Open the live site like a visitor and log when each API request starts and finishes and when the
// list's first card appears, for the home view and after zooming into Oklahoma City.
import { chromium } from "playwright";
const SITE = process.env.SITE || "https://bizestimate-six.vercel.app";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1366, height: 820 } });
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
p.on("request", (r) => r.url().includes("/api/") && console.log(`${at()} start  ${r.url().replace(SITE, "").slice(0, 110)}`));
p.on("requestfinished", async (r) => r.url().includes("/api/") && console.log(`${at()} done   ${r.url().replace(SITE, "").slice(0, 110)}`));
p.on("requestfailed", (r) => r.url().includes("/api/") && console.log(`${at()} FAILED ${r.url().replace(SITE, "").slice(0, 110)} ${r.failure()?.errorText}`));
await p.goto(SITE, { waitUntil: "commit" });
await p.waitForSelector(".card", { timeout: 120000 }).then(() => console.log(`${at()} FIRST CARD (home)`)).catch(() => console.log(`${at()} no card after 120s`));
await p.waitForTimeout(3000);
console.log(`${at()} --- zooming into Oklahoma City`);
const m = await p.locator(".map").boundingBox();
await p.mouse.move(m.x + m.width * 0.52, m.y + m.height * 0.55);
for (let i = 0; i < 4; i++) { await p.mouse.wheel(0, -500); await p.waitForTimeout(400); }
const before = await p.locator(".count").textContent().catch(() => "");
console.log(`${at()} list header: ${before}`);
for (let i = 0; i < 40; i++) {
  await p.waitForTimeout(1000);
  const txt = await p.locator(".count").textContent().catch(() => "");
  if (i % 5 === 0 || !/Updating|Loading/.test(txt)) console.log(`${at()} list header: ${txt}`);
  if (!/Updating|Loading/.test(txt)) break;
}
await b.close();
