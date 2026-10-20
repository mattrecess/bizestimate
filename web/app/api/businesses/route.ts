import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { parseFilters, publicAddress, where } from "@/lib/queries";

const SORTS = {
  revenue_desc: sql`est_revenue_mid desc nulls last`,
  revenue_asc: sql`est_revenue_mid asc nulls last`,
  ebitda_desc: sql`est_ebitda_mid desc nulls last`,
  jobs_desc: sql`jobs_reported desc nulls last`,
  name: sql`name asc`,
};

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const f = parseFilters(p);
  const sort = SORTS[(p.get("sort") as keyof typeof SORTS) ?? "revenue_desc"] ?? SORTS.revenue_desc;
  const limit = Math.min(Number(p.get("limit")) || 50, 200);
  const offset = Math.max(Number(p.get("offset")) || 0, 0);
  const w = where(f);

  const [rows, [{ count }]] = await Promise.all([
    sql`
      select id, name, ${publicAddress}, city, state, zip, naics, industry, jobs_reported,
             est_revenue_low, est_revenue_mid, est_revenue_high,
             est_ebitda_low, est_ebitda_mid, est_ebitda_high, est_confidence, lat, lon
      from businesses where ${w} order by ${sort} limit ${limit} offset ${offset}`,
    sql`select count(*)::int as count from businesses where ${w}`,
  ]);
  return NextResponse.json({ total: count, results: rows });
}
