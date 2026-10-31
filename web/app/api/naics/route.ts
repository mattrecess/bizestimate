import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { sql } from "@/lib/db";
import { CACHE } from "@/lib/queries";

// Every NAICS code in use, with its label and number of businesses (the NAICS filter's options).
// Grouping every business takes seconds; the codes change only with the overnight load, so kept a day.
const codes = unstable_cache(async () => [...await sql`
    select naics as code, mode() within group (order by industry) as label, count(*)::int as count
    from businesses where not is_individual and coalesce(naics, '') <> '' and coalesce(est_method, '') <> 'branch'
    group by naics order by naics`], ["naics-codes"], { revalidate: 86400 });

export async function GET() {
  return NextResponse.json(await codes(), { headers: { "Cache-Control": CACHE } });
}
