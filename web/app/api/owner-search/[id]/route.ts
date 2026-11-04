import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { ownerSearchConfigured, searchOwner } from "@/lib/owner-search";

// "Search the web for the owner": signed-in users only. Each business is searched at most once every
// RETRY_DAYS (a search costs about a fifth of a cent, but shouldn't be repeatable at will), and each user
// may start PER_USER_DAY searches a day. A found owner is saved for everyone: on the business now, and as an
// 'owner_lookup' source so data loads keep it (etl/enrich.py apply_owners).
const RETRY_DAYS = 30;
const PER_USER_DAY = 25;

async function tables() {
  await sql`create table if not exists owner_lookups (
    biz_key text primary key, user_id bigint, found boolean not null, searched_at timestamptz not null default now())`;
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const [user, admin] = await Promise.all([currentUser(), isAdmin()]);
  if (!user && !admin) return NextResponse.json({ error: "Sign in to search for the owner." }, { status: 401 });
  if (!ownerSearchConfigured()) return NextResponse.json({ error: "Owner search isn't set up yet." }, { status: 503 });
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const [b] = await sql`select biz_key, name, city, owner_name from businesses where id = ${id}`;
  if (!b) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (b.owner_name) return NextResponse.json({ owner: { name: b.owner_name } });

  await tables();
  const [recent] = await sql`select found from owner_lookups
    where biz_key = ${b.biz_key} and searched_at > now() - make_interval(days => ${RETRY_DAYS})`;
  if (recent) return NextResponse.json({ owner: null, message: "We searched the web for this owner recently and didn't find a name. We'll try again later." });
  if (user && !admin) {
    const [{ n }] = await sql`select count(*)::int as n from owner_lookups where user_id = ${user.id} and searched_at > now() - interval '1 day'`;
    if (n >= PER_USER_DAY) return NextResponse.json({ error: "You've reached today's limit for owner searches. Try again tomorrow." }, { status: 429 });
  }

  let found;
  try {
    found = await searchOwner(b.name, b.city);
  } catch (e) {
    console.error("owner search failed", e);
    return NextResponse.json({ error: "The search didn't go through. Try again in a minute." }, { status: 502 });
  }
  await sql`insert into owner_lookups (biz_key, user_id, found) values (${b.biz_key}, ${user?.id ?? null}, ${!!found})
    on conflict (biz_key) do update set user_id = excluded.user_id, found = excluded.found, searched_at = now()`;
  if (!found) return NextResponse.json({ owner: null, message: "We couldn't find the owner named anywhere on the web." });

  await sql`insert into business_sources (biz_key, source, data) values (${b.biz_key}, 'owner_lookup', ${sql.json(found)})
    on conflict (biz_key, source) do update set data = excluded.data, updated_at = now()`;
  await sql`update businesses set owner_name = ${found.name}, owner_title = ${found.title.slice(0, 60)}, owner_source = ${found.url}
    where biz_key = ${b.biz_key} and coalesce(owner_name, '') = ''`;
  revalidatePath(`/business/${id}`);
  return NextResponse.json({ owner: found });
}
