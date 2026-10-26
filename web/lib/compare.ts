import { sql } from "./db";

export type CompareRow = {
  id: string; name: string; city: string; industry: string; naics: string | null; jobs_reported: number | null;
  est_revenue_low: string | null; est_revenue_mid: string | null; est_revenue_high: string | null;
  est_ebitda_low: string | null; est_ebitda_mid: string | null; est_ebitda_high: string | null;
  est_method: string; is_nonprofit: boolean; owner_name: string | null; website: string | null;
  sell_score: number | null; founded: number | null; employees_latest: number | null; employees_year: number | null;
};

export async function compareRows(ids: string[]): Promise<CompareRow[]> {
  if (!ids.length) return [];
  const rows = await sql<CompareRow[]>`
    select b.id, b.name, b.city, b.industry, b.naics, b.jobs_reported, b.est_revenue_low, b.est_revenue_mid, b.est_revenue_high,
           b.est_ebitda_low, b.est_ebitda_mid, b.est_ebitda_high, b.est_method, b.is_nonprofit, b.owner_name, b.website,
           (to_jsonb(b) ->> 'sell_score')::int as sell_score,
           (select (s.data ->> 'year')::int from business_sources s where s.biz_key = b.biz_key and s.source = 'founded') as founded,
           h.employees as employees_latest, h.year as employees_year
    from businesses b
    left join lateral (select employees, year from headcounts h where h.biz_key = b.biz_key order by year desc limit 1) h on true
    where b.id in ${sql(ids)}`;
  return ids.map((id) => rows.find((r) => String(r.id) === id)).filter((r): r is CompareRow => !!r);
}
