import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Called by the data load when it finishes (etl/load.py). Cached pages (business and industry pages keep a
// rendered copy for a day) are refreshed only when the database holds a newer load than the last refresh, so
// anyone can call this without being able to make the site re-render at will.
export async function GET() {
  try {
    const [row] = await sql`
      select (select value #>> '{}' from etl_state where key = 'last_load') as loaded,
             (select value #>> '{}' from etl_state where key = 'pages_refreshed') as refreshed`;
    if (!row?.loaded) return NextResponse.json({ refreshed: false, reason: "no load recorded" });
    if (row.refreshed && new Date(row.refreshed) >= new Date(row.loaded)) {
      return NextResponse.json({ refreshed: false, reason: "already current" });
    }
    revalidatePath("/", "layout");
    await sql`insert into etl_state (key, value, updated_at) values ('pages_refreshed', to_jsonb(now()), now())
              on conflict (key) do update set value = excluded.value, updated_at = now()`;
    return NextResponse.json({ refreshed: true, load: row.loaded });
  } catch (e) {
    return NextResponse.json({ refreshed: false, reason: String(e).slice(0, 200) }, { status: 500 });
  }
}
