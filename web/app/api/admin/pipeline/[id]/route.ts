import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { isAdmin } from "@/lib/admin";

// Your pipeline entry and notes for one business. Signed-in admin only; never cached.
const NO_STORE = { "Cache-Control": "private, no-store" };
const STATUSES = ["watching", "contacted", "talking", "passed"] as const;

async function bizKey(id: string) {
  if (!/^\d+$/.test(id)) return null;
  const [b] = await sql`select biz_key from businesses where id = ${id}`;
  return (b?.biz_key as string) ?? null;
}

async function current(key: string) {
  const [entry] = await sql`select status, to_char(follow_up, 'YYYY-MM-DD') as follow_up from pipeline where biz_key = ${key}`;
  const notes = await sql`select id, body, created_at from pipeline_notes where biz_key = ${key} order by created_at desc limit 50`;
  return { entry: entry ?? null, notes };
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ admin: false }, { status: 401, headers: NO_STORE });
  const key = await bizKey((await params).id);
  if (!key) return NextResponse.json({ error: "not found" }, { status: 404, headers: NO_STORE });
  return NextResponse.json({ admin: true, ...(await current(key)) }, { headers: NO_STORE });
}

// Body: { status?, follow_up?, note?, delete_note?, remove? }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ admin: false }, { status: 401, headers: NO_STORE });
  const key = await bizKey((await params).id);
  if (!key) return NextResponse.json({ error: "not found" }, { status: 404, headers: NO_STORE });
  const body = await req.json().catch(() => ({}));
  if (body.remove) {
    await sql`delete from pipeline where biz_key = ${key}`;
  } else if (body.status !== undefined || body.follow_up !== undefined) {
    const status = STATUSES.includes(body.status) ? body.status : "watching";
    const follow = /^\d{4}-\d{2}-\d{2}$/.test(body.follow_up ?? "") ? body.follow_up : null;
    await sql`insert into pipeline (biz_key, status, follow_up, updated_at) values (${key}, ${status}, ${follow}, now())
              on conflict (biz_key) do update set status = excluded.status, follow_up = excluded.follow_up, updated_at = now()`;
  }
  const note = String(body.note ?? "").trim().slice(0, 5000);
  if (note) {
    await sql`insert into pipeline (biz_key) values (${key}) on conflict do nothing`;
    await sql`insert into pipeline_notes (biz_key, body) values (${key}, ${note})`;
  }
  if (body.delete_note) await sql`delete from pipeline_notes where id = ${String(body.delete_note)} and biz_key = ${key}`;
  return NextResponse.json({ admin: true, ...(await current(key)) }, { headers: NO_STORE });
}
