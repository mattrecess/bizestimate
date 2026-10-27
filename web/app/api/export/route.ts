import { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { parseFilters, relevance, valueSql, where } from "@/lib/queries";
import { estimateValue } from "@/lib/valuation";
import { SITE_URL } from "@/lib/site";

const MAX_ROWS = 1000;
const SORTS: Record<string, ReturnType<typeof sql>> = {
  revenue_desc: sql`est_revenue_mid desc nulls last, id`, revenue_asc: sql`est_revenue_mid asc nulls last, id`,
  ebitda_desc: sql`est_ebitda_mid desc nulls last, id`, jobs_desc: sql`jobs_reported desc nulls last, id`,
  sell_desc: sql`sell_score desc nulls last, est_revenue_mid desc nulls last, id`, name: sql`name asc, id`,
  value_desc: sql`${valueSql} desc nulls last, est_revenue_mid desc nulls last, id`,
};

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// The list as a spreadsheet: the same filters and order, first MAX_ROWS businesses. Estimates and
// public facts only; contact details aren't included.
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const f = parseFilters(p);
  const sort = SORTS[p.get("sort") ?? "revenue_desc"] ?? SORTS.revenue_desc;
  const rows = await sql`
    select id, name, case when is_individual then null else address end as address, city, zip, industry, naics,
           jobs_reported, est_revenue_low, est_revenue_mid, est_revenue_high, est_ebitda_low, est_ebitda_mid,
           est_ebitda_high, est_method, is_nonprofit, website, owner_name, owner_title,
           to_jsonb(businesses) ->> 'sell_score' as sell_score
    from businesses where ${where(f)} and coalesce(est_method, '') <> 'branch' order by ${relevance(f)} ${sort} limit ${MAX_ROWS}`;
  const head = ["Name", "Address", "City", "ZIP", "Industry", "NAICS", "Employees (reported)", "Revenue low", "Revenue estimate",
    "Revenue high", "EBITDA estimate", "Value estimate", "Basis", "Owner", "Owner title", "Website", "Likely-to-sell score", "Profile"];
  const whole = (v: unknown) => (v == null || v === "" ? "" : Math.round(Number(v)));
  const lines = rows.map((r) => [
    r.name, r.address, r.city, r.zip, r.industry, r.naics, r.jobs_reported, whole(r.est_revenue_low), whole(r.est_revenue_mid),
    whole(r.est_revenue_high), whole(r.est_ebitda_mid), whole(estimateValue(r)?.mid), r.est_method, r.owner_name, r.owner_title,
    r.website, r.sell_score, `${SITE_URL}/business/${r.id}`,
  ].map(cell).join(","));
  const date = new Date().toISOString().slice(0, 10);
  return new Response([head.join(","), ...lines].join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bizestimate-${date}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
