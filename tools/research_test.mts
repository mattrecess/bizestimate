// Try step 3 of the owner search (web/lib/owner-research.ts) on businesses whose owners we know, and print
// what it finds and what it cost in tokens. Run via the Research test workflow.
import { researchOwner } from "../web/lib/owner-research.ts";

const cases: [string, string, string][] = [
  ["VANTAGE POINT ITAD LLC", "Oklahoma City", "Steven Lampson"],
  ["LIGHTLE SAND & CONSTRUCTION LLC", "Hennessey", "David Dollar"],
];
for (const [name, city, expected] of cases) {
  const t0 = Date.now();
  try {
    const found = await researchOwner(name, city);
    console.log(`${name}: ${found ? `${found.name} (${found.title}) via ${found.url}` : "nothing verified"} | expected ${expected} | ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  } catch (e) {
    console.log(`${name}: ERROR ${String(e).slice(0, 300)}`);
  }
}
