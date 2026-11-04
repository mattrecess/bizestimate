import { NextRequest, NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { sql } from "@/lib/db";
import { isAdmin } from "@/lib/admin";

// Your corrections to a business's people, from its page (shown only when you're signed in to /admin):
//   { action: "owner", name, title }: set the owner (kept over anything found automatically on every load,
//     as /admin's owner form does), dropping a wrong owner the web search found;
//   { action: "hide", name }: take a person off the Leadership card for everyone (people_hidden source).
export async function GET() {
  return NextResponse.json({ admin: await isAdmin() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const id = (await params).id;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const [b] = await sql`select biz_key, owner_name from businesses where id = ${id}`;
  if (!b) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim().slice(0, 80);
  if (!name) return NextResponse.json({ error: "A name is needed." }, { status: 400 });

  if (body.action === "owner") {
    const title = String(body.title ?? "").trim().slice(0, 60) || "Owner";
    await sql`insert into known_owners (biz_key, owner_name, owner_title, note, updated_at)
              values (${b.biz_key}, ${name}, ${title}, 'Set on the business page', now())
              on conflict (biz_key) do update set owner_name = excluded.owner_name, owner_title = excluded.owner_title,
                note = excluded.note, updated_at = now()`;
    await sql`update businesses set owner_name = ${name}, owner_title = ${title}, owner_source = null where biz_key = ${b.biz_key}`;
    // A different owner the web search found was wrong: don't let a later load bring it back.
    await sql`delete from business_sources where biz_key = ${b.biz_key} and source = 'owner_lookup'
              and lower(data ->> 'name') <> lower(${name})`;
  } else if (body.action === "hide") {
    const [saved] = await sql`select data from business_sources where biz_key = ${b.biz_key} and source = 'people_hidden'`;
    const names: string[] = saved?.data?.names ?? [];
    if (!names.some((n) => n.toLowerCase() === name.toLowerCase())) names.push(name);
    await sql`insert into business_sources (biz_key, source, data) values (${b.biz_key}, 'people_hidden', ${sql.json({ names })})
              on conflict (biz_key, source) do update set data = excluded.data, updated_at = now()`;
    // Also off the executive search's saved list, so it isn't merged back.
    await sql`update business_sources set data = jsonb_set(data, '{people}', coalesce((select jsonb_agg(p) from jsonb_array_elements(data -> 'people') p
                where lower(p ->> 'name') <> lower(${name})), '[]'::jsonb))
              where biz_key = ${b.biz_key} and source = 'leadership_lookup'`;
  } else {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  revalidatePath(`/business/${id}`);
  revalidateTag(`biz-${id}`);
  return NextResponse.json({ ok: true });
}
