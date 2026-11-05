// Run the owner search's three steps on given businesses with debug output. Run via the Research test workflow.
import { searchOwner } from "../web/lib/owner-search.ts";
import { researchOwner } from "../web/lib/owner-research.ts";

process.env.OWNER_SEARCH_DEBUG = "1";
for (const [name, city] of [["RED DIRT SEPTIC AND BACKHOE, LLC", "Edmond"], ["Red Dirt Septic", "Tuttle"]]) {
  const t0 = Date.now();
  try {
    console.log(`=== ${name} (${city}) steps 1-2`);
    const a = await searchOwner(name, city);
    console.log(`steps 1-2: ${a ? JSON.stringify(a) : "nothing"} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    if (!a) {
      const b = await researchOwner(name, city);
      console.log(`step 3: ${b ? JSON.stringify(b) : "nothing"} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    }
  } catch (e) {
    console.log(`${name}: ERROR ${String(e).slice(0, 400)}`);
  }
}
