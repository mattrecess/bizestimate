import { sql } from "./db";
import { INDUSTRIES, slug, type Industry } from "./industries";
import { industryMatch } from "./queries";

// Pages for "<industry> in <city>, Oklahoma": an industry's slug is its label, a city's is its name.
export { slug };
export const industryBySlug = (s: string) => INDUSTRIES.find((i) => slug(i.label) === s) ?? null;
export const MIN_LISTED = 5;   // fewer than this and a page has too little to show

const listed = sql`not is_individual and coalesce(est_method, '') <> 'branch'`;

export type Summary = { count: number; revenue_total: number | null; revenue_median: number | null; ebitda_median: number | null };
export type Row = { id: string; name: string; city: string; jobs_reported: number | null; est_revenue_mid: string | null;
  est_ebitda_mid: string | null; est_method: string };

export async function summary(ind: Industry, city?: string): Promise<Summary> {
  const [s] = await sql<Summary[]>`
    select count(*)::int as count, sum(est_revenue_mid)::float8 as revenue_total,
           percentile_cont(0.5) within group (order by est_revenue_mid) as revenue_median,
           percentile_cont(0.5) within group (order by est_ebitda_mid) as ebitda_median
    from businesses where ${listed} and (${industryMatch(ind.naics)}) ${city ? sql`and lower(city) = ${city.toLowerCase()}` : sql``}`;
  return s;
}

export const top = (ind: Industry, city?: string, limit = 50) => sql<Row[]>`
  select id, name, city, jobs_reported, est_revenue_mid, est_ebitda_mid, est_method from businesses
  where ${listed} and (${industryMatch(ind.naics)}) ${city ? sql`and lower(city) = ${city.toLowerCase()}` : sql``}
  order by est_revenue_mid desc nulls last, id limit ${limit}`;

export const cities = (ind: Industry) => sql<{ city: string; count: number }[]>`
  select initcap(lower(city)) as city, count(*)::int as count from businesses
  where ${listed} and (${industryMatch(ind.naics)}) and coalesce(city, '') <> ''
  group by 1 having count(*) >= ${MIN_LISTED} order by 2 desc, 1`;

// The city as stored, from its slug ("broken-arrow" -> "Broken Arrow"), if this industry has it.
export async function cityBySlug(ind: Industry, s: string) {
  return (await cities(ind)).find((c) => slug(c.city) === s) ?? null;
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
