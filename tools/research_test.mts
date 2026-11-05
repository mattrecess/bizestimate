import { researchLeadership } from "../web/lib/owner-research.ts";
process.env.OWNER_SEARCH_DEBUG = "1";
for (let i = 0; i < 2; i++) {
  const team = await researchLeadership("MINICK MATERIALS COMPANY", "Oklahoma City").catch((e) => { console.log(String(e)); return []; });
  console.log(`team | Minick run ${i + 1}: ${team.map((p) => `${p.name} (${p.title})`).join(", ") || "nobody"}`);
}
