import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { sql } from "@/lib/db";
import { CACHE, listWhere, parseFilters } from "@/lib/queries";

// The exact number of businesses a list search matches. Asked for separately from the list, so the
// first page shows straight away and the number fills in when the count finishes. The same search
// (the opening view of the state especially) is counted once every 10 minutes, not once per visitor.
const countFor = unstable_cache(async (query: string) => {
  const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from businesses
    where ${listWhere(parseFilters(new URLSearchParams(query)))}`;
  return count;
}, ["business-count"], { revalidate: 600 });

export async function GET(req: NextRequest) {
  const p = new URLSearchParams(req.nextUrl.searchParams);
  p.sort();
  return NextResponse.json({ total: await countFor(p.toString()) }, { headers: { "Cache-Control": CACHE } });
}
