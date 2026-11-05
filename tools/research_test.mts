// The AI research steps (web/lib/owner-research.ts) on known businesses, with debug output. Run via the Research test workflow.
import { researchLeadership, researchOwner } from "../web/lib/owner-research.ts";

process.env.OWNER_SEARCH_DEBUG = "1";
const time = (t0: number) => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
for (const [name, city] of [["RED DIRT SEPTIC AND BACKHOE, LLC", "Edmond"], ["LIGHTLE SAND & CONSTRUCTION LLC", "Hennessey"]]) {
  const t0 = Date.now();
  const r = await researchOwner(name, city).catch((e) => `ERROR ${String(e).slice(0, 300)}`);
  console.log(`owner | ${name}: ${typeof r === "string" ? r : r ? `${r.name} (${r.title}) ${r.url}` : "nothing"} (${time(t0)})`);
}
const t0 = Date.now();
const team = await researchLeadership("MINICK MATERIALS COMPANY", "Oklahoma City").catch(() => []);
console.log(`team | Minick: ${team.map((p) => `${p.name} (${p.title})`).join(", ") || "nobody"} (${time(t0)})`);
