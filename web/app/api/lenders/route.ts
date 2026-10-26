import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { CACHE } from "@/lib/queries";

// Banks that lent to listed businesses (PPP and SBA loans), most connected first.
export async function GET() {
  const rows = await sql`
    select lender_key as key, min(lender) as name, count(distinct business_id)::int as count
    from business_lenders group by lender_key order by count desc limit 600`.catch(() => []);
  return NextResponse.json(rows, { headers: { "Cache-Control": CACHE } });
}
