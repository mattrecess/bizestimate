import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { CACHE } from "@/lib/queries";
import { REVENUE_STEPS } from "@/lib/revenue-steps";

// How many listed businesses fall between each pair of slider steps (the revenue filter's histogram).
export async function GET() {
  const bounds = REVENUE_STEPS.slice(1);
  const counts = new Array(REVENUE_STEPS.length).fill(0);
  const [r2] = await sql`
    select json_object_agg(b, n) as m from (
      select width_bucket(est_revenue_mid, ${bounds}::numeric[]) as b, count(*)::int as n
      from businesses where est_revenue_mid > 0 and not is_individual and coalesce(est_method, '') <> 'branch'
      group by 1) t`;
  for (const [b, n] of Object.entries((r2?.m ?? {}) as Record<string, number>)) counts[Number(b)] = n;
  return NextResponse.json(counts, { headers: { "Cache-Control": CACHE } });
}
