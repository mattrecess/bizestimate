// The owner search's three steps on one business, with debug output. Run via the Research test workflow.
import { searchOwner } from "../web/lib/owner-search.ts";
import { researchOwner } from "../web/lib/owner-research.ts";

process.env.OWNER_SEARCH_DEBUG = "1";
const [name, city] = ["SUPERIOR BUILDING SERVICES, INC", "Tulsa"];
const t0 = Date.now();
const a = await searchOwner(name, city).catch((e) => { console.log("steps 1-2 failed:", String(e)); return null; });
console.log(`steps 1-2: ${a ? JSON.stringify(a) : "nothing"} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
const b = await researchOwner(name, city).catch((e) => { console.log("step 3 failed:", String(e)); return null; });
console.log(`step 3: ${b ? JSON.stringify(b) : "nothing"} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
