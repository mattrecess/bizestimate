import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { ownerSearchConfigured, searchOwner } from "@/lib/owner-search";
import { PRO_PRICE } from "@/lib/reveals";

// "Search the web for the owner": signed-in users only. Free accounts get FREE_PER_MONTH searches a calendar
// month (then the upgrade prompt); Pro is unlimited, with a quiet PRO_PER_DAY ceiling against runaway use
// (a search costs about a fifth of a cent). The admin is never limited. A search can be repeated any time. A found owner is saved for everyone: on the business now, and as an
// 'owner_lookup' source so data loads keep it (etl/enrich.py apply_owners).
const FREE_PER_MONTH = 5;
const PRO_PER_DAY = 200;

async function tables() {
  await sql`create table if not exists owner_lookups (
    biz_key text primary key, user_id bigint, found boolean not null, searched_at timestamptz not null default now())`;
  await sql`create table if not exists owner_search_log (
    user_id bigint, biz_key text not null, found boolean not null, searched_at timestamptz not null default now())`;
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
  if (user && !admin) {
    const pro = user.plan === "pro";
    const [{ n }] = pro
      ? await sql`select count(*)::int as n from owner_search_log where user_id = ${user.id} and searched_at > now() - interval '1 day'`
      : await sql`select count(*)::int as n from owner_search_log where user_id = ${user.id} and searched_at >= date_trunc('month', now())`;
    if (!pro && n >= FREE_PER_MONTH) {
      return NextResponse.json({ error: "You've used this month's free owner searches.", kind: "owner-search", used: n, limit: FREE_PER_MONTH, price: PRO_PRICE }, { status: 402 });
    }
    if (pro && n >= PRO_PER_DAY) return NextResponse.json({ error: "That's a lot of searches for one day. Try again tomorrow." }, { status: 429 });
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
  await sql`insert into owner_search_log (user_id, biz_key, found) values (${user?.id ?? null}, ${b.biz_key}, ${!!found})`;
  if (!found) return NextResponse.json({ owner: null, message: "We couldn't find the owner named anywhere on the web." });

  await sql`insert into business_sources (biz_key, source, data) values (${b.biz_key}, 'owner_lookup', ${sql.json(found)})
    on conflict (biz_key, source) do update set data = excluded.data, updated_at = now()`;
  await sql`update businesses set owner_name = ${found.name}, owner_title = ${found.title.slice(0, 60)}, owner_source = ${found.url}
    where biz_key = ${b.biz_key} and coalesce(owner_name, '') = ''`;
  revalidatePath(`/business/${id}`);
  return NextResponse.json({ owner: found });
}
