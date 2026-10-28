import { NextRequest, NextResponse } from "next/server";
import { authConfigured, currentUser, endSession, type User } from "@/lib/auth";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

type Biz = { id: string; name: string; city: string };
type Search = { label: string; query: string };

async function lists(u: User) {
  const businesses = await sql<Biz[]>`select business_id as id, name, coalesce(city, '') as city
    from user_saved_businesses where user_id = ${u.id} order by created_at desc`;
  const searches = await sql<Search[]>`select label, query from user_saved_searches where user_id = ${u.id} order by created_at desc`;
  return { businesses, searches };
}

// The signed-in visitor and their saved businesses and searches ({user: null} when signed out).
export async function GET() {
  const u = authConfigured() ? await currentUser() : null;
  if (!u) return NextResponse.json({ user: null, signInAvailable: authConfigured() }, { headers: { "cache-control": "no-store" } });
  return NextResponse.json({ user: { email: u.email, name: u.name, picture: u.picture }, ...(await lists(u)) },
    { headers: { "cache-control": "no-store" } });
}

// Changes to the saved lists. "merge" adds what was saved in this browser before signing in.
export async function POST(req: NextRequest) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await req.json() as
    { op: "merge"; businesses?: Biz[]; searches?: Search[] } | { op: "save" | "unsave"; business: Biz }
    | { op: "save_search"; search: Search } | { op: "remove_search"; query: string } | { op: "delete_account" };
  if (body.op === "delete_account") {
    await sql`delete from users where id = ${u.id}`;   // saved lists go with it (on delete cascade)
    await endSession();
    return NextResponse.json({ deleted: true });
  }
  const clip = (s: unknown, n = 300) => String(s ?? "").slice(0, n);
  if (body.op === "merge" || body.op === "save") {
    const bs = body.op === "merge" ? (body.businesses ?? []).slice(0, 200) : [body.business];
    for (const b of bs.filter((b) => /^\d+$/.test(String(b.id)))) {
      await sql`insert into user_saved_businesses (user_id, business_id, name, city)
        values (${u.id}, ${String(b.id)}, ${clip(b.name)}, ${clip(b.city, 100)}) on conflict do nothing`;
    }
  }
  if (body.op === "merge" || body.op === "save_search") {
    const ss = body.op === "merge" ? (body.searches ?? []).slice(0, 50) : [body.search];
    for (const s of ss.filter((s) => s.query)) {
      await sql`insert into user_saved_searches (user_id, query, label) values (${u.id}, ${clip(s.query, 2000)}, ${clip(s.label)})
        on conflict (user_id, query) do update set label = excluded.label, created_at = now()`;
    }
  }
  if (body.op === "unsave") await sql`delete from user_saved_businesses where user_id = ${u.id} and business_id = ${String(body.business.id)}`;
  if (body.op === "remove_search") await sql`delete from user_saved_searches where user_id = ${u.id} and query = ${body.query}`;
  return NextResponse.json(await lists(u));
}
