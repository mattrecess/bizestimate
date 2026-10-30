import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { CACHE, parseFilters, where } from "@/lib/queries";

// The exact number of businesses a list search matches. Asked for separately from the list, so the
// first page shows straight away and the number fills in when the count finishes.
export async function GET(req: NextRequest) {
  const w = sql`${where(parseFilters(req.nextUrl.searchParams))} and coalesce(est_method, '') <> 'branch'`;
  const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from businesses where ${w}`;
  return NextResponse.json({ total: count }, { headers: { "Cache-Control": CACHE } });
}
