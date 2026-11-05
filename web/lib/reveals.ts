import { sql } from "./db";
import type { User } from "./auth";
import { isPro, isUnlimited } from "./plan";

// Contact details (the business's published ones and its owner's) are shown to signed-in users only:
// a free account sees FREE businesses' contacts a month, Pro up to PRO (a guard against bulk copying).
// Seeing the same business again in the same month doesn't count twice.
export const FREE = Number(process.env.CONTACT_REVEALS_FREE) || 5;
export const PRO = Number(process.env.CONTACT_REVEALS_PRO) || 300;
export const PRO_PRICE = process.env.NEXT_PUBLIC_PRO_PRICE || "$99";

export type Allowance = { ok: boolean; used: number; limit: number; plan: string };

export async function tables() {
  await sql`create table if not exists owner_contact_reveals (
    user_id bigint not null, biz_key text not null, revealed_at timestamptz not null default now(), primary key (user_id, biz_key))`;
  await sql`create table if not exists pro_interest (user_id bigint primary key, created_at timestamptz not null default now())`;
  await sql`alter table users add column if not exists plan text not null default 'free'`;
  await sql`alter table users add column if not exists contact_terms_at timestamptz`;
}

/** Whether this user may see this business's contacts now, recording it when they may. */
export async function reveal(user: User, bizKey: string): Promise<Allowance> {
  await tables();
  const limit = isUnlimited(user.plan) ? Number.MAX_SAFE_INTEGER : isPro(user.plan) ? PRO : FREE;
  const [{ used, seen }] = await sql<{ used: number; seen: boolean }[]>`
    select count(*)::int as used, bool_or(biz_key = ${bizKey}) as seen from owner_contact_reveals
    where user_id = ${user.id} and revealed_at >= date_trunc('month', now())`;
  if (seen) return { ok: true, used, limit, plan: user.plan };
  if (used >= limit) return { ok: false, used, limit, plan: user.plan };
  // A business revealed in an earlier month counts again this month.
  await sql`insert into owner_contact_reveals (user_id, biz_key) values (${user.id}, ${bizKey})
    on conflict (user_id, biz_key) do update set revealed_at = now()`;
  return { ok: true, used: used + 1, limit, plan: user.plan };
}

/** Whether this user has already revealed this business this month (the owner lookup needs that first). */
export async function revealedThisMonth(user: User, bizKey: string) {
  const [r] = await sql`select 1 from owner_contact_reveals where user_id = ${user.id} and biz_key = ${bizKey}
    and revealed_at >= date_trunc('month', now())`.catch(() => []);
  return !!r;
}
