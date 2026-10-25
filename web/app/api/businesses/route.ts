import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { matchIndustry } from "@/lib/industries";
import { CACHE, parseFilters, publicAddress, relevance, where } from "@/lib/queries";

// Each ends with id, so ties (equal revenue) keep one order and continuous scrolling never repeats
// or skips a business between batches.
const SORTS = {
  revenue_desc: sql`est_revenue_mid desc nulls last, id`,
  revenue_asc: sql`est_revenue_mid asc nulls last, id`,
  ebitda_desc: sql`est_ebitda_mid desc nulls last, id`,
  jobs_desc: sql`jobs_reported desc nulls last, id`,
  name: sql`name asc, id`,
};

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const f = parseFilters(p);
  const sort = SORTS[(p.get("sort") as keyof typeof SORTS) ?? "revenue_desc"] ?? SORTS.revenue_desc;
  const limit = Math.min(Number(p.get("limit")) || 50, 200);
  const offset = Math.max(Number(p.get("offset")) || 0, 0);
  const w = where(f);

  // The page and the total run side by side; without a window count, the page can come straight
  // off an index instead of sorting every matching business.
  const [rows, [{ count }]] = await Promise.all([
    sql`
      select id, name, ${publicAddress}, city, state, zip, naics, industry, jobs_reported, is_nonprofit, to_jsonb(businesses) ->> 'parent_name' as parent_name,
             est_revenue_low, est_revenue_mid, est_revenue_high,
             est_ebitda_low, est_ebitda_mid, est_ebitda_high, est_confidence, est_method, lat, lon,
             coalesce(owner_name, '') <> '' as has_owner,
             coalesce(website, '') <> '' as has_website
      from businesses where ${w} order by ${relevance(f)} ${sort} limit ${limit} offset ${offset}`,
    sql`select count(*)::int as count from businesses where ${w}`,
  ]);
  // Let Vercel's CDN answer repeat requests (the default view especially) without the database.
  // Tell the page when a search reads as an industry ("janitorial", "janitorial tulsa"), so it can
  // say so; not when the other words are a name ("Triple Bar Ranch" is a ranch, not a bar).
  const m = f.q ? matchIndustry(f.q) : null;
  const industry = !m ? null
    : !m.rest || (await sql`select 1 from businesses where lower(city) = ${m.rest} limit 1`).length
      ? m.industry.label : null;
  return NextResponse.json({ total: count, results: rows, industry }, { headers: { "Cache-Control": CACHE } });
}
