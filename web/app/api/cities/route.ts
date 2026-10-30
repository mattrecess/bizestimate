import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Cities change only with the overnight load; kept a day so each visit doesn't regroup every business.
const cityCounts = unstable_cache(async () => sql`
    select city, count(*)::int as count from businesses
    where city is not null and city <> ''
    group by city having count(*) >= 10 order by city`, ["city-counts"], { revalidate: 86400 });

export async function GET() {
  return NextResponse.json(await cityCounts(), { headers: { "Cache-Control": "public, s-maxage=86400" } });
}
