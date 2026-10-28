// Walk through the live site like a visitor, on a deliberately slow connection, and take screenshots
// while things load: what does a person see while waiting? Writes PNGs and a log to OUT.
//   SITE=https://... OUT=shots node tools/ux_test.mjs
import { chromium, devices } from "playwright";
import fs from "node:fs";

const SITE = process.env.SITE || "https://bizestimate-six.vercel.app";
const OUT = process.env.OUT || "shots";
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => { const s = a.join(" "); console.log(s); fs.appendFileSync(`${OUT}/log.txt`, s + "\n"); };
const b = await chromium.launch();

async function slow(page) {
  // About a fast 3G phone: every request waits 300ms more and downloads at ~1.5 Mbit/s.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 300, downloadThroughput: 190_000, uploadThroughput: 90_000 });
}

async function run(name, ctxOpts, fn) {
  const ctx = await b.newContext(ctxOpts);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => log(`${name}: PAGE ERROR ${e.message}`));
  p.on("console", (m) => m.type() === "error" && log(`${name}: console error ${m.text().slice(0, 200)}`));
  p.on("response", (r) => r.status() >= 400 && r.url().startsWith(SITE) && log(`${name}: HTTP ${r.status()} ${r.url().replace(SITE, "")}`));
  await slow(p);
  const t0 = Date.now();
  const shot = async (label) => { await p.screenshot({ path: `${OUT}/${name}-${label}.png` }); log(`${name}: ${label} @${Date.now() - t0}ms`); };
  try { await fn(p, shot, t0); } catch (e) { log(`${name}: FAILED ${e.message.split("\n")[0]}`); await shot("failed").catch(() => {}); }
  await ctx.close();
}

const desktop = { viewport: { width: 1366, height: 820 } };
const phone = { ...devices["iPhone 13"] };

await run("d1-home", desktop, async (p, shot, t0) => {
  await p.goto(SITE, { waitUntil: "commit" });
  await p.waitForTimeout(700); await shot("0.7s");
  await p.waitForTimeout(1500); await shot("2.2s");
  await p.waitForSelector(".card", { timeout: 60000 }); log(`d1-home: first card @${Date.now() - t0}ms`); await shot("cards");
  await p.waitForTimeout(4000); await shot("settled");
});

await run("d2-search", desktop, async (p, shot) => {
  await p.goto(SITE); await p.waitForSelector(".card", { timeout: 60000 }); await p.waitForTimeout(2500);
  await p.click("input[type=search]"); await p.keyboard.type("janit", { delay: 80 });
  await p.waitForTimeout(150); await shot("typing");
  await p.waitForTimeout(600); await shot("0.75s");
  await p.waitForTimeout(2500); await shot("3s");
  await p.keyboard.press("Enter"); await p.waitForTimeout(400); await shot("enter-0.4s");
  await p.waitForTimeout(3000); await shot("enter-3s");
});

await run("d3-filter", desktop, async (p, shot) => {
  await p.goto(SITE); await p.waitForSelector(".card", { timeout: 60000 }); await p.waitForTimeout(2500);
  await p.click('button.pill:has-text("Revenue")'); await p.waitForTimeout(400); await shot("revenue-open");
  await p.selectOption(".range-boxes select >> nth=0", { index: 5 }); await p.waitForTimeout(300); await shot("after-min-0.3s");
  await p.keyboard.press("Escape"); await p.waitForTimeout(3000); await shot("after-min-3s");
  await p.click('button.pill:has-text("NAICS")'); await p.waitForTimeout(300); await shot("naics-open-0.3s");
  await p.waitForTimeout(2500); await shot("naics-open-2.8s");
});

await run("d4-pan", desktop, async (p, shot) => {
  await p.goto(SITE); await p.waitForSelector(".card", { timeout: 60000 }); await p.waitForTimeout(3000);
  const m = await p.locator(".map").boundingBox();
  await p.mouse.move(m.x + m.width / 2, m.y + m.height / 2);
  await p.mouse.wheel(0, -600); await p.waitForTimeout(800);
  await p.mouse.down(); await p.mouse.move(m.x + m.width / 2 - 200, m.y + m.height / 2 - 80, { steps: 10 }); await p.mouse.up();
  await p.waitForTimeout(300); await shot("pan-0.3s");
  await p.waitForTimeout(1500); await shot("pan-1.8s");
  await p.waitForTimeout(3000); await shot("pan-4.8s");
});

await run("d5-open", desktop, async (p, shot) => {
  await p.goto(SITE); await p.waitForSelector(".card", { timeout: 60000 }); await p.waitForTimeout(2500);
  await p.locator(".card").nth(2).click(); await p.waitForTimeout(250); await shot("click-0.25s");
  await p.waitForTimeout(1200); await shot("click-1.5s");
  await p.waitForTimeout(3000); await shot("click-4.5s");
  await p.evaluate(() => document.querySelector(".panel")?.scrollTo({ top: 1400 })); await p.waitForTimeout(500); await shot("scrolled");
});

await run("m1-home", phone, async (p, shot) => {
  await p.goto(SITE, { waitUntil: "commit" }); await p.waitForTimeout(1000); await shot("1s");
  await p.waitForSelector(".map canvas", { timeout: 60000 }); await p.waitForTimeout(3500); await shot("map");
  await p.locator('button:has-text("List")').first().tap().catch(() => {}); await p.waitForTimeout(1500); await shot("list");
  await p.locator(".card").first().tap(); await p.waitForTimeout(400); await shot("open-0.4s");
  await p.waitForTimeout(3000); await shot("open-3.4s");
});

await run("m2-search", phone, async (p, shot) => {
  await p.goto(SITE); await p.waitForTimeout(3000);
  await p.tap("input[type=search]"); await p.keyboard.type("plumbing tulsa", { delay: 60 });
  await p.waitForTimeout(400); await shot("typing");
  await p.waitForTimeout(2500); await shot("3s");
});

for (const [name, path] of [["d6-business", "/business/1311985"], ["d7-industry", "/oklahoma/commercial-cleaning-and-janitorial"], ["d8-deals", "/deals"]]) {
  await run(name, desktop, async (p, shot, t0) => {
    await p.goto(SITE + path, { waitUntil: "commit" }); await p.waitForTimeout(800); await shot("0.8s");
    await p.waitForLoadState("load", { timeout: 60000 }); log(`${name}: loaded @${Date.now() - t0}ms`); await shot("loaded");
  });
}

await b.close();
log("done");
