// Try the AI research steps (web/lib/owner-research.ts) on known businesses and print what gets verified.
// Run via the Research test workflow.
import { researchLeadership } from "../web/lib/owner-research.ts";

for (const [name, city] of [["MINICK MATERIALS COMPANY", "Oklahoma City"], ["LIGHTLE SAND & CONSTRUCTION LLC", "Hennessey"]]) {
  const t0 = Date.now();
  try {
    const people = await researchLeadership(name, city);
    console.log(`${name}: ${people.length} verified in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    for (const p of people) console.log(`  ${p.name} | ${p.title || "role not listed"} | ${p.url}`);
  } catch (e) {
    console.log(`${name}: ERROR ${String(e).slice(0, 300)}`);
  }
}
