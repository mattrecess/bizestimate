// Web searches started from a business page (owner search, executive search) share one allowance: signed-in
// users only; free accounts get FREE_PER_MONTH a calendar month, then the upgrade prompt; Pro is unlimited
// with a quiet PRO_PER_DAY ceiling against runaway use; the admin is never limited. Each search is logged.
import { NextResponse } from "next/server";
import { sql } from "./db";
import { currentUser } from "./auth";
import { isAdmin } from "./admin";
import { PRO_PRICE } from "./reveals";
import { isPro, isUnlimited } from "./plan";

export const FREE_PER_MONTH = 5;
const PRO_PER_DAY = 200;

async function tables() {
  await sql`create table if not exists owner_search_log (
    user_id bigint, biz_key text not null, found boolean not null, searched_at timestamptz not null default now())`;
  await sql`alter table owner_search_log add column if not exists kind text not null default 'owner'`;
}

// { userId } when the search may go ahead, else the response to send.
export async function checkQuota(what: string): Promise<{ userId: number | null } | NextResponse> {
  const [user, admin] = await Promise.all([currentUser(), isAdmin()]);
  if (!user && !admin) return NextResponse.json({ error: `Sign in to search for ${what}.` }, { status: 401 });
  await tables();
  if (user && !admin && !isUnlimited(user.plan)) {
    const pro = isPro(user.plan);
    const [{ n }] = pro
      ? await sql`select count(*)::int as n from owner_search_log where user_id = ${user.id} and searched_at > now() - interval '1 day'`
      : await sql`select count(*)::int as n from owner_search_log where user_id = ${user.id} and searched_at >= date_trunc('month', now())`;
    if (!pro && n >= FREE_PER_MONTH) {
      return NextResponse.json({ error: "You've used this month's free web searches.", kind: "owner-search", used: n, limit: FREE_PER_MONTH, price: PRO_PRICE }, { status: 402 });
    }
    if (pro && n >= PRO_PER_DAY) return NextResponse.json({ error: "That's a lot of searches for one day. Try again tomorrow." }, { status: 429 });
  }
  return { userId: user?.id ?? null };
}

export async function logSearch(userId: number | null, bizKey: string, found: boolean, kind: "owner" | "leadership") {
  await sql`insert into owner_search_log (user_id, biz_key, found, kind) values (${userId}, ${bizKey}, ${found}, ${kind})`;
}
