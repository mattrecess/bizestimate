import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { CACHE } from "@/lib/queries";

// Every NAICS code in use, with its label and number of businesses (the NAICS filter's options).
export async function GET() {
  const rows = await sql`
    select naics as code, mode() within group (order by industry) as label, count(*)::int as count
    from businesses where not is_individual and coalesce(naics, '') <> '' and coalesce(est_method, '') <> 'branch'
    group by naics order by naics`;
  return NextResponse.json(rows, { headers: { "Cache-Control": CACHE } });
}
