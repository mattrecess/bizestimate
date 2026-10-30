import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { listWhere, parseFilters, relevance, valueSql } from "@/lib/queries";
import { estimateValue } from "@/lib/valuation";
import { SITE_URL } from "@/lib/site";
import { xlsx, type Column } from "@/lib/xlsx";

const MAX_ROWS = 1000;
const SORTS: Record<string, ReturnType<typeof sql>> = {
  revenue_desc: sql`est_revenue_mid desc nulls last, id`, revenue_asc: sql`est_revenue_mid asc nulls last, id`,
  ebitda_desc: sql`est_ebitda_mid desc nulls last, id`, jobs_desc: sql`jobs_reported desc nulls last, id`,
  sell_desc: sql`sell_score desc nulls last, est_revenue_mid desc nulls last, id`, name: sql`name asc, id`,
  value_desc: sql`${valueSql} desc nulls last, est_revenue_mid desc nulls last, id`,
};

const COLUMNS: Column[] = [
  { header: "Name", width: 36 }, { header: "Address", width: 28 }, { header: "City", width: 16 }, { header: "ZIP", width: 8 },
  { header: "Industry", width: 30 }, { header: "NAICS", width: 9 }, { header: "Employees (reported)", width: 12 },
  { header: "Revenue low", money: true }, { header: "Revenue estimate", money: true }, { header: "Revenue high", money: true },
  { header: "EBITDA estimate", money: true }, { header: "Value estimate", money: true }, { header: "Basis", width: 14 },
  { header: "Owner", width: 22 }, { header: "Owner title", width: 14 }, { header: "Website", width: 28 },
  { header: "Likely-to-sell score", width: 10 }, { header: "SeeBITDA page", width: 40 },
];

// The table as an Excel file: the same filters and order, first MAX_ROWS businesses. Estimates and
// public facts only; contact details aren't included. Signed-in visitors only.
export async function GET(req: NextRequest) {
  if (!(await currentUser())) return NextResponse.json({ error: "Sign in to export" }, { status: 401 });
  const p = req.nextUrl.searchParams;
  const f = parseFilters(p);
  const sort = SORTS[p.get("sort") ?? "revenue_desc"] ?? SORTS.revenue_desc;
  const rows = await sql`
    select id, name, case when is_individual then null else address end as address, city, zip, industry, naics,
           jobs_reported, est_revenue_low, est_revenue_mid, est_revenue_high, est_ebitda_low, est_ebitda_mid,
           est_ebitda_high, est_value_mid, est_method, is_nonprofit, website, owner_name, owner_title,
           to_jsonb(businesses) ->> 'sell_score' as sell_score
    from businesses where ${listWhere(f)} order by ${relevance(f)} ${sort} limit ${MAX_ROWS}`;
  const whole = (v: unknown) => (v == null || v === "" ? null : Math.round(Number(v)));
  const data = rows.map((r) => [
    r.name, r.address, r.city, r.zip, r.industry, r.naics, r.jobs_reported == null ? null : Number(r.jobs_reported),
    whole(r.est_revenue_low), whole(r.est_revenue_mid), whole(r.est_revenue_high), whole(r.est_ebitda_mid),
    whole(estimateValue(r)?.mid), r.est_method, r.owner_name, r.owner_title, r.website,
    r.sell_score == null ? null : Number(r.sell_score), `${SITE_URL}/business/${r.id}`,
  ]);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(xlsx("Businesses", COLUMNS, data), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="seebitda-oklahoma-businesses-${date}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
