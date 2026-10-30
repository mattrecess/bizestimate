// Load the live site in headless Chromium and time what a visitor waits for:
// pins on the map after page load, and results after typing a company name.
//   SITE=https://... node tools/browser_probe.mjs
import { chromium } from "playwright";

const SITE = process.env.SITE || "https://www.seebitda.com";
const b = await chromium.launch();

async function visit(label, run) {
  const p = await b.newPage({ viewport: { width: 1400, height: 850 } });
  const t0 = Date.now();
  const reqs = new Map();
  p.on("request", (r) => r.url().includes("/api/") && reqs.set(r, Date.now()));
  p.on("requestfinished", async (r) => {
    if (!reqs.has(r)) return;
    const res = await r.response();
    const size = (await r.sizes().catch(() => ({}))).responseBodySize;
    console.log(`  ${label} +${reqs.get(r) - t0}ms -> ${Date.now() - reqs.get(r)}ms ${res?.status()} ` +
      `cdn=${res?.headers()["x-vercel-cache"] ?? "-"} ${size ?? "?"}B ${r.url().replace(SITE, "")}`);
  });
  p.on("pageerror", (e) => console.log(`  ${label} pageerror ${e.message}`));
  await run(p, t0);
  await p.close();
}

for (const round of [1, 2]) {
  await visit(`home#${round}`, async (p, t0) => {
    await p.goto(SITE, { waitUntil: "domcontentloaded" });
    console.log(`home#${round}: html ${Date.now() - t0}ms`);
    await p.waitForSelector(".card", { timeout: 30000 });
    console.log(`home#${round}: first cards ${Date.now() - t0}ms`);
    await p.waitForSelector(".map canvas", { timeout: 30000 });
    // Pins are drawn once a /api/points response has arrived and the map is idle.
    await p.waitForResponse((r) => r.url().includes("/api/points"), { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(300);
    console.log(`home#${round}: points response by ${Date.now() - t0}ms`);
    await p.waitForTimeout(4000);
  });
  await visit(`search#${round}`, async (p, t0) => {
    await p.goto(SITE, { waitUntil: "domcontentloaded" });
    await p.waitForSelector(".card", { timeout: 30000 });
    // Fresh names each run, so the CDN can't have cached them.
    const pool = ["zeeco", "latshaw", "fabricut", "covercraft", "luckinbill", "greystone", "paragon",
      "mertz", "alliance steel", "evans enterprises", "southwestern wire", "dean mcgee", "stillwater milling"];
    const words = [...pool].sort(() => Math.random() - 0.5);
    const t = Date.now();
    await p.locator(".searchbox input").pressSequentially(words[round - 1], { delay: 90 });
    const typed = Date.now();
    await p.waitForSelector(".suggestions li", { timeout: 30000 }).catch(() => {});
    console.log(`search#${round}: "${words[round - 1]}" typed in ${typed - t}ms; suggestions ${Date.now() - typed}ms after last key`);
    await p.waitForFunction((w) => [...document.querySelectorAll(".card .name")].some((n) =>
      n.textContent.toLowerCase().includes(w.split(" ")[0])), words[round - 1], { timeout: 30000 }).catch(() => {});
    console.log(`search#${round}: list shows a match ${Date.now() - typed}ms after last key`);
    const before = Date.now();
    await p.locator(".card").first().click();
    await p.waitForSelector(".detail h1", { timeout: 30000 }).catch(() => {});
    console.log(`search#${round}: profile open ${Date.now() - before}ms after click`);
    await p.waitForTimeout(2000);
  });
}
await b.close();
