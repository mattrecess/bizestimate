import { NextRequest, NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { sql } from "@/lib/db";
import { ownerSearchConfigured, searchOwner } from "@/lib/owner-search";
import { checkQuota, logSearch } from "@/lib/search-quota";
import { researchOwner } from "@/lib/owner-research";

// Step 3 (AI web research) can take up to a minute.
export const maxDuration = 120;

// "Search the web for the owner", on the shared search allowance (lib/search-quota.ts: free accounts 5 a month,
// Pro unlimited). A search can be repeated any time. A found owner is saved for everyone: on the business now,
// and as an 'owner_lookup' source so data loads keep it (etl/enrich.py apply_owners).
async function tables() {
  await sql`create table if not exists owner_lookups (
    biz_key text primary key, user_id bigint, found boolean not null, searched_at timestamptz not null default now())`;
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const quota = await checkQuota("the owner");
  if (quota instanceof NextResponse) return quota;
  if (!ownerSearchConfigured()) return NextResponse.json({ error: "Owner search isn't set up yet." }, { status: 503 });
  const [b] = await sql`select biz_key, name, city, owner_name from businesses where id = ${id}`;
  if (!b) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (b.owner_name) return NextResponse.json({ owner: { name: b.owner_name } });

  await tables();
  let found;
  try {
    // Steps 1-2: two Google searches read by Claude; step 3, only if they find nothing: Claude researches the
    // web itself and the page it cites is checked (lib/owner-research.ts).
    // If the Google steps fail (e.g. Serper out of credits), go straight to step 3 rather than giving up.
    found = await searchOwner(b.name, b.city).catch((e) => { console.error("owner search: Google steps failed", e); return null; })
      ?? await researchOwner(b.name, b.city);
  } catch (e) {
    console.error("owner search failed", e);
    return NextResponse.json({ error: "The search didn't go through. Try again in a minute." }, { status: 502 });
  }
  await sql`insert into owner_lookups (biz_key, user_id, found) values (${b.biz_key}, ${quota.userId}, ${!!found})
    on conflict (biz_key) do update set user_id = excluded.user_id, found = excluded.found, searched_at = now()`;
  await logSearch(quota.userId, b.biz_key, !!found, "owner");
  if (!found) return NextResponse.json({ owner: null, message: "We couldn't find the owner named anywhere on the web." });

  await sql`insert into business_sources (biz_key, source, data) values (${b.biz_key}, 'owner_lookup', ${sql.json(found)})
    on conflict (biz_key, source) do update set data = excluded.data, updated_at = now()`;
  await sql`update businesses set owner_name = ${found.name}, owner_title = ${found.title.slice(0, 60)}, owner_source = ${found.url}
    where biz_key = ${b.biz_key} and coalesce(owner_name, '') = ''`;
  revalidatePath(`/business/${id}`);
  revalidateTag(`biz-${id}`);   // the map panel's copy (app/api/businesses/[id])
  return NextResponse.json({ owner: found });
}
