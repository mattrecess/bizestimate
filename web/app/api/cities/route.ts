import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await sql`
    select city, count(*)::int as count from businesses
    where city is not null and city <> ''
    group by city having count(*) >= 10 order by city`;
  return NextResponse.json(rows, { headers: { "Cache-Control": "public, s-maxage=86400" } });
}
