import { sql } from "./db";
import { INDUSTRIES, slug, type Industry } from "./industries";
import { industryMatch, valueSql } from "./queries";

// Pages for "<industry> in <city>, Oklahoma": an industry's slug is its label, a city's is its name.
export { slug };
export const industryBySlug = (s: string) => INDUSTRIES.find((i) => slug(i.label) === s) ?? null;
export const MIN_LISTED = 5;   // fewer than this and a page has too little to show

const listed = sql`not is_individual and coalesce(est_method, '') <> 'branch'`;

export type Summary = { count: number; revenue_total: number | null; revenue_median: number | null; ebitda_median: number | null;
  value_median: number | null; multiple_median: number | null; likely_to_sell: number;
  bands: { under1: number; m1to5: number; m5to25: number; over25: number } };
export type Row = { id: string; name: string; city: string; jobs_reported: number | null; est_revenue_mid: string | null;
  est_ebitda_mid: string | null; est_method: string };

export async function summary(ind: Industry, city?: string): Promise<Summary> {
  const [s] = await sql`
    with b as (
      select est_revenue_mid, est_ebitda_mid, sell_score, ${valueSql} as value from businesses
      where ${listed} and (${industryMatch(ind.naics)}) ${city ? sql`and lower(city) = ${city.toLowerCase()}` : sql``})
    select count(*)::int as count, sum(est_revenue_mid)::float8 as revenue_total,
           percentile_cont(0.5) within group (order by est_revenue_mid) as revenue_median,
           percentile_cont(0.5) within group (order by est_ebitda_mid) as ebitda_median,
           percentile_cont(0.5) within group (order by value) as value_median,
           percentile_cont(0.5) within group (order by value / nullif(est_ebitda_mid, 0)) filter (where value > 0) as multiple_median,
           count(*) filter (where sell_score >= 40)::int as likely_to_sell,
           count(*) filter (where est_revenue_mid < 1e6)::int as under1,
           count(*) filter (where est_revenue_mid >= 1e6 and est_revenue_mid < 5e6)::int as m1to5,
           count(*) filter (where est_revenue_mid >= 5e6 and est_revenue_mid < 25e6)::int as m5to25,
           count(*) filter (where est_revenue_mid >= 25e6)::int as over25
    from b`;
  return { count: s.count, revenue_total: s.revenue_total, revenue_median: s.revenue_median, ebitda_median: s.ebitda_median,
    value_median: s.value_median, multiple_median: s.multiple_median, likely_to_sell: s.likely_to_sell,
    bands: { under1: s.under1, m1to5: s.m1to5, m5to25: s.m5to25, over25: s.over25 } };
}

export const top = (ind: Industry, city?: string, limit = 50) => sql<Row[]>`
  select id, name, city, jobs_reported, est_revenue_mid, est_ebitda_mid, est_method from businesses
  where ${listed} and (${industryMatch(ind.naics)}) ${city ? sql`and lower(city) = ${city.toLowerCase()}` : sql``}
  order by est_revenue_mid desc nulls last, id limit ${limit}`;

// The likeliest sellers and the latest deals, for the market report.
export const sellers = (ind: Industry, city?: string, limit = 5) => sql<(Row & { sell_score: number; sell_signals: string[] | null })[]>`
  select id, name, city, jobs_reported, est_revenue_mid, est_ebitda_mid, est_method, sell_score, sell_signals from businesses
  where ${listed} and sell_score >= 40 and (${industryMatch(ind.naics)}) ${city ? sql`and lower(city) = ${city.toLowerCase()}` : sql``}
  order by sell_score desc, est_revenue_mid desc nulls last, id limit ${limit}`.catch(() => []);

export const deals = (ind: Industry, city?: string, limit = 5) => sql<{ id: string; name: string; city: string; buyer: string;
  deal_date: string | null; deal_type: string | null }[]>`
  select b.id, b.name, b.city, t.buyer, t.deal_date::text, t.deal_type from transactions t join businesses b on b.biz_key = t.biz_key
  where (${industryMatch(ind.naics)}) ${city ? sql`and lower(b.city) = ${city.toLowerCase()}` : sql``}
  order by t.deal_date desc nulls last limit ${limit}`.catch(() => []);

export const cities = (ind: Industry) => sql<{ city: string; count: number }[]>`
  select initcap(lower(city)) as city, count(*)::int as count from businesses
  where ${listed} and (${industryMatch(ind.naics)}) and coalesce(city, '') <> ''
  group by 1 having count(*) >= ${MIN_LISTED} order by 2 desc, 1`;

// The city as stored, from its slug ("broken-arrow" -> "Broken Arrow"), if this industry has it.
export async function cityBySlug(ind: Industry, s: string) {
  return (await cities(ind)).find((c) => slug(c.city) === s) ?? null;
}

// Every industry's cities with enough businesses for a page, from one grouped query (the sitemap):
// a query per industry took over a minute.
export async function allIndustryCities() {
  const byCodeCity = await sql<{ naics: string; city: string; count: number }[]>`
    select coalesce(naics, '') as naics, initcap(lower(city)) as city, count(*)::int as count from businesses
    where ${listed} and coalesce(city, '') <> '' group by 1, 2`;
  return INDUSTRIES.map((ind) => {
    const counts = new Map<string, number>();
    for (const r of byCodeCity) {
      if (ind.naics.some((c) => r.naics.startsWith(c) || (r.naics.length >= 4 && r.naics.length <= 5 && c.startsWith(r.naics)))) {
        counts.set(r.city, (counts.get(r.city) ?? 0) + r.count);
      }
    }
    const total = [...counts.values()].reduce((n, x) => n + x, 0);
    return { ind, total, cities: [...counts].filter(([, n]) => n >= MIN_LISTED).map(([city]) => city) };
  }).filter((r) => r.total >= MIN_LISTED);
}

// Industries with enough businesses for a page, and their counts (the index and sitemap). One
// grouped query, matched to industries here with the same rule as industryMatch.
export async function industryCounts() {
  const byCode = await sql<{ naics: string; count: number }[]>`
    select coalesce(naics, '') as naics, count(*)::int as count from businesses where ${listed} group by 1`;
  return INDUSTRIES.map((ind) => ({
    ind,
    count: byCode.filter((r) => ind.naics.some((c) => r.naics.startsWith(c) || (r.naics.length >= 4 && r.naics.length <= 5 && c.startsWith(r.naics))))
      .reduce((n, r) => n + r.count, 0),
  })).filter((r) => r.count >= MIN_LISTED);
}
