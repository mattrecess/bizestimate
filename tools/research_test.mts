// Steps 1-2 of the owner search on one business, showing Serper's full answer if it fails.
import { searchOwner } from "../web/lib/owner-search.ts";
process.env.OWNER_SEARCH_DEBUG = "1";
const a = await searchOwner("SUPERIOR BUILDING SERVICES, INC", "Tulsa").catch((e) => { console.log("steps 1-2 failed:", String(e)); return null; });
console.log(`steps 1-2: ${a ? JSON.stringify(a) : "nothing"}`);
