import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { industryLabel, matchIndustry } from "@/lib/industries";
import { CACHE, naicsQuery, parseFilters, publicAddress, relevance, valueSql, where } from "@/lib/queries";

// Each ends with id, so ties (equal revenue) keep one order and continuous scrolling never repeats
// or skips a business between batches.
const SORTS = {
  revenue_desc: sql`est_revenue_mid desc nulls last, id`,
  revenue_asc: sql`est_revenue_mid asc nulls last, id`,
  ebitda_desc: sql`est_ebitda_mid desc nulls last, id`,
  jobs_desc: sql`jobs_reported desc nulls last, id`,
  name: sql`name asc, id`,
  value_desc: sql`${valueSql} desc nulls last, est_revenue_mid desc nulls last, id`,
  sell_desc: sql`sell_score desc nulls last, est_revenue_mid desc nulls last, id`,
};

const COUNT_CAP = 5000;

// The exact number in view. A count can take seconds when the database is busy (a city-sized view is
// ~40,000 businesses), so it gets COUNT_MS; past that the list falls back to "5,000+".
const COUNT_MS = 2500;
async function countAll(w: ReturnType<typeof where>) {
  try {
    const [{ count }] = await sql.begin(async (tx) => {
      await tx`set local statement_timeout = ${sql.unsafe(String(COUNT_MS))}`;
      return tx<{ count: number }[]>`select count(*)::int as count from businesses where ${w}`;
    });
    return { count, capped: false };
  } catch {
    const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from (select 1 from businesses where ${w} limit ${COUNT_CAP + 1}) t`;
    return { count: Math.min(count, COUNT_CAP), capped: count > COUNT_CAP };
  }
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const f = parseFilters(p);
  const sort = SORTS[(p.get("sort") as keyof typeof SORTS) ?? "revenue_desc"] ?? SORTS.revenue_desc;
  const limit = Math.min(Number(p.get("limit")) || 50, 200);
  const offset = Math.max(Number(p.get("offset")) || 0, 0);
  // The list shows each company once: extra locations (est_method 'branch') stay on the map but
  // appear in the list only as their parent's location count.
  const w = sql`${where(f)} and coalesce(est_method, '') <> 'branch'`;

  // The page and the total run side by side; without a window count, the page can come straight
  // off an index instead of sorting every matching business.
  const [rows, { count, capped }] = await Promise.all([
    sql`
      select id, name, ${publicAddress}, city, state, zip, naics, industry, jobs_reported, is_nonprofit, to_jsonb(businesses) ->> 'parent_name' as parent_name,
             est_revenue_low, est_revenue_mid, est_revenue_high,
             est_ebitda_low, est_ebitda_mid, est_ebitda_high, est_confidence, est_method, lat, lon,
             coalesce(owner_name, '') <> '' as has_owner,
             coalesce(website, '') <> '' as has_website, to_jsonb(businesses) ->> 'sell_score' as sell_score,
             (select count(*)::int from businesses c where c.parent_key = businesses.biz_key) as locations
             ${f.lender?.length ? sql`, (select json_agg(json_build_object('lender', bl.lender, 'program', bl.program, 'year', bl.year)
                 order by bl.year desc nulls last) from business_lenders bl
                 where bl.business_id = businesses.id and bl.lender_key in ${sql(f.lender)}) as lenders` : sql``}
      -- Location counts per row on the page only, via businesses_parent_idx (not a count over every listing).
      from businesses
      where ${w} order by ${relevance(f)} ${sort} limit ${limit} offset ${offset}`,
    countAll(w),
  ]);
  // Let Vercel's CDN answer repeat requests (the default view especially) without the database.
  // Tell the page when a search reads as an industry ("janitorial", "janitorial tulsa"), so it can
  // say so; not when the other words are a name ("Triple Bar Ranch" is a ranch, not a bar).
  const code = naicsQuery(f.q);
  if (code) {
    const [b] = await sql`select label from industry_benchmarks where ${code.code} like naics_prefix || '%'
                          order by length(naics_prefix) desc limit 1`.catch(() => []);
    const label = industryLabel(code.code) ?? b?.label;
    return NextResponse.json({ total: count, capped, results: rows, industry: `NAICS ${code.code}${label ? ` · ${label}` : ""}` },
      { headers: { "Cache-Control": CACHE } });
  }
  const m = f.q ? matchIndustry(f.q) : null;
  const industry = !m ? null
    : !m.rest || (await sql`select 1 from businesses where lower(city) = ${m.rest} limit 1`).length
      ? m.industry.label : null;
  return NextResponse.json({ total: count, capped, results: rows, industry }, { headers: { "Cache-Control": CACHE } });
}
