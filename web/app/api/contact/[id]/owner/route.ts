import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { lookupOwner, pdlConfigured, type OwnerContact } from "@/lib/pdl";
import { revealedThisMonth } from "@/lib/reveals";
import { isPro } from "@/lib/plan";

// "Get owner contact": the owner's email and phone from People Data Labs, for signed-in users who have
// revealed this business's contacts this month (which is what's counted, lib/reveals.ts). A lookup is saved and reused for everyone (PDL is paid per match),
// and redone after LOOKUP_DAYS in case the person changed jobs.
const LOOKUP_DAYS = 180;

async function tables() {
  await sql`alter table users add column if not exists plan text not null default 'free'`;
  await sql`alter table users add column if not exists contact_terms_at timestamptz`;
  await sql`create table if not exists owner_contacts (
    biz_key text primary key, data jsonb not null, found boolean not null, fetched_at timestamptz not null default now())`;
  await sql`create table if not exists owner_contact_reveals (
    user_id bigint not null, biz_key text not null, revealed_at timestamptz not null default now(), primary key (user_id, biz_key))`;
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const [user, admin] = await Promise.all([currentUser(), isAdmin()]);
  if (!user && !admin) return NextResponse.json({ error: "Sign in to see owner contact details." }, { status: 401 });
  if (!pdlConfigured()) return NextResponse.json({ error: "Owner contact lookups aren't set up yet." }, { status: 503 });
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [b] = await sql`select biz_key, name, city, to_jsonb(businesses) ->> 'owner_name' as owner from businesses where id = ${id}`;
  if (!b) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!b.owner) return NextResponse.json({ error: "We don't know this business's owner yet, so there's no one to look up." }, { status: 422 });
  const [optout] = await sql`select 1 from contact_optouts where biz_key = ${b.biz_key}`.catch(() => []);
  if (optout) return NextResponse.json({ error: "This business asked for its contact details not to be shown." }, { status: 403 });

  await tables();
  // Counted with the business's contacts (lib/reveals.ts): the owner's come only after those were shown.
  if (user && !admin && !(await revealedThisMonth(user, b.biz_key))) {
    return NextResponse.json({ error: "Show this business's contact info first." }, { status: 402 });
  }

  const [saved] = await sql<{ data: OwnerContact }[]>`select data from owner_contacts
    where biz_key = ${b.biz_key} and fetched_at > now() - make_interval(days => ${LOOKUP_DAYS})`;
  let result = saved?.data;
  if (!result) {
    try {
      result = await lookupOwner(b.owner, b.name, b.city);
    } catch (e) {
      console.error("owner lookup failed", e);
      return NextResponse.json({ error: "The lookup service didn't respond. Try again in a minute." }, { status: 502 });
    }
    await sql`insert into owner_contacts (biz_key, data, found) values (${b.biz_key}, ${sql.json(result)}, ${result.found})
      on conflict (biz_key) do update set data = excluded.data, found = excluded.found, fetched_at = now()`;
  }
  // Phone numbers from PDL may be personal cell phones: shown only to Pro users who have accepted the
  // contact-use terms (no auto-dialing or texting without consent, Do Not Call checks), and to the admin.
  const phonesBlocked = admin ? null : !isPro(user?.plan) ? "pro" : !user.contact_terms_at ? "terms" : null;
  const phones = phonesBlocked ? [] : result.phones;
  return NextResponse.json({ owner: b.owner, ...result, phones, phonesHidden: phonesBlocked ? result.phones.length : 0, phonesBlocked },
    { headers: { "Cache-Control": "private, no-store" } });
}
