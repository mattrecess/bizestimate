// Open a few live business pages (and the map panel) and print any client-side errors with their stack.
import { chromium } from "playwright";
import fs from "node:fs";
const SITE = process.env.SITE || "https://www.seebitda.com";
const OUT = process.env.OUT || "shots";
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
for (const path of ["/business/1316278", "/business/1312636", "/business/1450384", "/?id=1316278"]) {
  const p = await b.newPage();
  p.on("pageerror", (e) => console.log(`${path}: PAGE ERROR ${e.message}\n${(e.stack || "").split("\n").slice(0, 6).join("\n")}`));
  p.on("console", (m) => m.type() === "error" && !/tile|Failed to load resource/.test(m.text()) && console.log(`${path}: console ${m.text().slice(0, 500)}`));
  await p.goto(SITE + path, { waitUntil: "networkidle", timeout: 60000 }).catch((e) => console.log(path, "goto", e.message));
  await p.waitForTimeout(4000);
  console.log(path, "profile rendered:", await p.locator(".profile").count(), "| app error:", await p.getByText("Application error").count());
  await p.screenshot({ path: `${OUT}/${path.replace(/\W/g, "_")}.png` });
  await p.close();
}
await b.close();
