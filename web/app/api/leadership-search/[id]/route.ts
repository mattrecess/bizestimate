import { NextRequest, NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { sql } from "@/lib/db";
import { ownerSearchConfigured } from "@/lib/owner-search";
import { searchLeadership, type Executive } from "@/lib/leadership-search";
import { checkQuota, logSearch } from "@/lib/search-quota";
import { researchLeadership } from "@/lib/owner-research";

// Step 3 (AI web research) can take up to a minute.
export const maxDuration = 120;

// "Search the web for executives" (lib/leadership-search.ts), on the shared search allowance (lib/search-quota.ts).
// People found are added to what earlier searches found and saved for everyone as a 'leadership_lookup' source,
// which the Leadership card shows (lib/leadership.ts).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const quota = await checkQuota("executives");
  if (quota instanceof NextResponse) return quota;
  if (!ownerSearchConfigured()) return NextResponse.json({ error: "Executive search isn't set up yet." }, { status: 503 });
  const [b] = await sql`select biz_key, name, city from businesses where id = ${id}`;
  if (!b) return NextResponse.json({ error: "not found" }, { status: 404 });

  let people: Executive[];
  try {
    // Google searches first; only if they find no one, Claude researches the web and each person's cited page
    // is checked (lib/owner-research.ts).
    people = await searchLeadership(b.name, b.city);
    if (!people.length) people = await researchLeadership(b.name, b.city);
  } catch (e) {
    console.error("leadership search failed", e);
    return NextResponse.json({ error: "The search didn't go through. Try again in a minute." }, { status: 502 });
  }
  await logSearch(quota.userId, b.biz_key, people.length > 0, "leadership");
  if (!people.length) return NextResponse.json({ people: [], message: "We couldn't find any executives named on the web." });

  const [saved] = await sql`select data from business_sources where biz_key = ${b.biz_key} and source = 'leadership_lookup'`;
  const merged = [...((saved?.data?.people ?? []) as Executive[])];
  for (const p of people) if (!merged.some((m) => m.name.toLowerCase() === p.name.toLowerCase())) merged.push(p);
  await sql`insert into business_sources (biz_key, source, data) values (${b.biz_key}, 'leadership_lookup', ${sql.json({ people: merged })})
    on conflict (biz_key, source) do update set data = excluded.data, updated_at = now()`;
  revalidatePath(`/business/${id}`);
  revalidateTag(`biz-${id}`);   // the map panel's copy (app/api/businesses/[id])
  return NextResponse.json({ people });
}
