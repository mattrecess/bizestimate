import { sql } from "./db";
import { matchIndustry } from "./industries";
import { SECTORS } from "./sectors";

export type Filters = {
  q?: string;
  sector?: string;
  city?: string;
  minRev?: number;
  maxRev?: number;
  naics?: string[];    // codes or prefixes ("561720", "2382")
  lender?: string[];   // business_lenders.lender_key
  // "More" filters
  minValue?: number; maxValue?: number; minEbitda?: number; maxEbitda?: number;
  minEmp?: number; maxEmp?: number;
  sell?: number;          // likely-to-sell score at least
  years?: number;         // in business at least this many years
  owner?: boolean; phone?: boolean; email?: boolean; website?: boolean; contractor?: boolean;
  basis?: string[];       // reported | k401 | ppp | avg
  noBranch?: boolean; noNonprofit?: boolean; noFranchise?: boolean;
  bbox?: [number, number, number, number]; // west, south, east, north
  area?: [number, number][];                // a shape drawn on the map: [lon, lat] corners
};

// Estimate basis -> est_method values.
const BASIS: Record<string, string[]> = {
  reported: ["reported", "verified"], k401: ["retirement_plan"], ppp: ["employees", "blend", "payroll", "owner_earnings"], avg: ["industry_average"],
};

// Estimated value, stored by the data load from the same multiples as lib/valuation.ts (multiples.json).
export const valueSql = sql`est_value_mid`;

// Latest headcount: the newest 401(k) filing, else the PPP application.
const employeesSql = sql`coalesce((select h.employees from headcounts h where h.biz_key = businesses.biz_key
  order by h.year desc limit 1), jobs_reported)`;
const hasSource = (source: string) => sql`exists (select 1 from business_sources s where s.biz_key = businesses.biz_key and s.source = ${source})`;

// "lon,lat;lon,lat;..." -> corners (3 to 80, valid numbers), or undefined.
function parseArea(v: string | null) {
  const pts = (v ?? "").split(";").map((s) => s.split(",").map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite));
  return pts.length >= 3 && pts.length <= 80 ? (pts as [number, number][]) : undefined;
}

const list = (v: string | null) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export function parseFilters(p: URLSearchParams): Filters {
  const num = (k: string) => (p.get(k) ? Number(p.get(k)) : undefined);
  const bbox = p.get("bbox")?.split(",").map(Number);
  return {
    q: p.get("q")?.trim() || undefined,
    sector: p.get("sector") || undefined,
    city: p.get("city")?.trim() || undefined,
    minRev: num("min_rev"),
    maxRev: num("max_rev"),
    naics: list(p.get("naics")).filter((c) => /^\d{2,6}$/.test(c)).slice(0, 50),
    lender: list(p.get("lender")).slice(0, 50),
    minValue: num("min_value"), maxValue: num("max_value"), minEbitda: num("min_ebitda"), maxEbitda: num("max_ebitda"),
    minEmp: num("min_emp"), maxEmp: num("max_emp"), sell: num("sell"), years: num("years"),
    owner: p.get("owner") === "1", phone: p.get("phone") === "1", email: p.get("email") === "1",
    website: p.get("website") === "1", contractor: p.get("contractor") === "1",
    basis: list(p.get("basis")).filter((b) => b in BASIS),
    noBranch: p.get("x_branch") === "1", noNonprofit: p.get("x_nonprofit") === "1", noFranchise: p.get("x_franchise") === "1",
    area: parseArea(p.get("area")),
    bbox: bbox?.length === 4 && bbox.every(Number.isFinite) ? (bbox as Filters["bbox"]) : undefined,
  };
}

// "5617", "561720", "naics 2382", "238220 tulsa": a NAICS code (2-6 digits) and any place words.
export function naicsQuery(q: string | undefined) {
  const m = q?.trim().match(/^(?:naics\s*:?\s*)?(\d{2,6})(?:\s+(.+))?$/i);
  return m ? { code: m[1], rest: (m[2] ?? "").trim() } : null;
}

export function where(f: Filters) {
  const prefixes = SECTORS.find((s) => s.label === f.sector)?.prefixes;
  const conds = [sql`true`];
  const code = naicsQuery(f.q);
  if (code) {
    // Every business whose code starts with it, plus map listings with only a coarser code that
    // it falls under (e.g. 5617 for 561720).
    conds.push(sql`(naics like ${code.code + "%"} or (length(naics) between 4 and 5 and ${code.code} like naics || '%'))`);
    if (code.rest) conds.push(sql`search @@ websearch_to_tsquery('simple', ${code.rest})`);
    f = { ...f, q: undefined };
  }
  // Every word of the query starts a word of the name ("tru solutions" -> TRUE SOLUTIONS ...,
  // "jk janitorial" -> J K JANITORIAL), or the name is a close misspelling of the query.
  if (f.q) {
    const words = queryWords(f.q);
    const allWords = words.length ? words.map(wordMatch).reduce((a, b) => sql`${a} and ${b}`) : sql`false`;
    // Each branch is index-backed (tsvector, name_norm trigrams, name trigrams via <%) so a search
    // touches only candidate rows instead of scanning every business.
    const byName = sql`search @@ websearch_to_tsquery('simple', ${f.q}) or (${allWords})
      or (${f.q} <% name and word_similarity(${f.q}, name) >= 0.8)`;
    // "commercial cleaning", "plumbers in tulsa": every business in that industry (and place) too.
    const m = matchIndustry(f.q);
    conds.push(m ? sql`(${byName} or (${industryMatch(m.industry.naics)} ${m.rest
      ? sql`and search @@ websearch_to_tsquery('simple', ${m.rest})` : sql``}))` : sql`(${byName})`);
  }
  if (prefixes) conds.push(sql`left(naics, 2) in ${sql(prefixes)}`);
  if (f.city) conds.push(sql`lower(city) = lower(${f.city})`);
  if (f.naics?.length) conds.push(sql`(${industryMatch(f.naics)})`);
  if (f.lender?.length) conds.push(sql`id in (select business_id from business_lenders where lender_key in ${sql(f.lender)})`);
  if (f.minRev !== undefined) conds.push(sql`est_revenue_mid >= ${f.minRev}`);
  if (f.maxRev !== undefined) conds.push(sql`est_revenue_mid <= ${f.maxRev}`);
  if (f.minValue !== undefined) conds.push(sql`${valueSql} >= ${f.minValue}`);
  if (f.maxValue !== undefined) conds.push(sql`${valueSql} <= ${f.maxValue}`);
  if (f.minEbitda !== undefined) conds.push(sql`est_ebitda_mid >= ${f.minEbitda}`);
  if (f.maxEbitda !== undefined) conds.push(sql`est_ebitda_mid <= ${f.maxEbitda}`);
  if (f.minEmp !== undefined) conds.push(sql`${employeesSql} >= ${f.minEmp}`);
  if (f.maxEmp !== undefined) conds.push(sql`${employeesSql} <= ${f.maxEmp}`);
  if (f.sell) conds.push(sql`(to_jsonb(businesses) ->> 'sell_score')::int >= ${f.sell}`);
  if (f.years) {
    const by = new Date().getFullYear() - f.years;
    conds.push(sql`exists (select 1 from business_sources s where s.biz_key = businesses.biz_key and (
      (s.source = 'founded' and (s.data ->> 'year')::int <= ${by})
      or (s.source = 'website_profile' and (s.data ->> 'founded_year')::int between 1800 and ${by})
      or (s.source = 'fdic' and (s.data ->> 'founded')::int <= ${by})))`);
  }
  if (f.owner) conds.push(sql`coalesce(owner_name, '') <> ''`);
  if (f.phone) conds.push(sql`(coalesce(to_jsonb(businesses) ->> 'phone', '') <> '' or coalesce(to_jsonb(businesses) ->> 'site_phone', '') <> ''
    or exists (select 1 from business_sources s where s.biz_key = businesses.biz_key and s.source = 'fmcsa' and s.data ->> 'phone' is not null))`);
  if (f.email) conds.push(sql`coalesce(to_jsonb(businesses) ->> 'site_email', '') <> ''`);
  if (f.website) conds.push(sql`coalesce(website, '') <> ''`);
  if (f.contractor) conds.push(hasSource("contracts"));
  if (f.basis?.length) conds.push(sql`est_method in ${sql(f.basis.flatMap((b) => BASIS[b]))}`);
  if (f.noBranch) conds.push(sql`coalesce(est_method, '') <> 'branch'`);
  if (f.noNonprofit) conds.push(sql`not is_nonprofit and not ${hasSource("irs990")}`);
  if (f.noFranchise) conds.push(sql`not exists (select 1 from business_sources s where s.biz_key = businesses.biz_key
    and s.source = 'sba' and s.data ->> 'franchise' is not null)`);
  if (f.area) {
    // Postgres's built-in polygon type: no extension needed. The box test lets the lat/lon index narrow it first.
    const lons = f.area.map((p) => p[0]), lats = f.area.map((p) => p[1]);
    const poly = `(${f.area.map(([x, y]) => `(${x},${y})`).join(",")})`;
    conds.push(sql`lat between ${Math.min(...lats)} and ${Math.max(...lats)} and lon between ${Math.min(...lons)} and ${Math.max(...lons)}
      and ${poly}::polygon @> point(lon, lat)`);
  }
  if (f.bbox && !f.area) {
    const [w, s, e, n] = f.bbox;
    conds.push(sql`lat between ${s} and ${n} and lon between ${w} and ${e}`);
  }
  return conds.reduce((acc, c) => sql`${acc} and ${c}`);
}

// A business is in the industry when its NAICS code starts with one of the industry's codes, or
// (map listings with only a coarse code, e.g. 5617) when its code starts one of them.
export function industryMatch(codes: string[]) {
  return codes
    .map((c) => sql`(naics like ${c + "%"} or (length(naics) between 4 and 5 and ${c} like naics || '%'))`)
    .reduce((a, b) => sql`${a} or ${b}`);
}

// Same normalisation as the name_norm column: upper case, punctuation out, single letters joined.
function queryWords(q: string) {
  return q.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim()
    .replace(/\b([A-Z0-9]) (?=[A-Z0-9]\b)/g, "$1")
    .split(" ").filter(Boolean).slice(0, 8);
}

const wordMatch = (w: string) => sql`name_norm ~ ${"\\m" + w}`;

// When searching: names matching more of the query's words first, then the closest spelling.
export function relevance(f: Filters) {
  if (!f.q || naicsQuery(f.q)) return sql``;
  const words = queryWords(f.q);
  const matched = words.length
    ? words.map((w) => sql`(${wordMatch(w)})::int`).reduce((a, b) => sql`${a} + ${b}`)
    : sql`0`;
  return sql`${matched} desc, word_similarity(${f.q}, name) desc,`;
}

// Search results can be served from Vercel's CDN: the data changes at most once a day.
// max-age lets the browser reuse a response it just fetched (e.g. going back to a search).
export const CACHE = "public, max-age=60, s-maxage=600, stale-while-revalidate=86400";

// Never expose a street address for individuals (sole props, self-employed).
export const publicAddress = sql`case when is_individual then null else address end as address`;

// Fast paths over the precomputed map tables (etl/map_tables.py) for the common case: a map view,
// optionally narrowed by sector, industry code, revenue, value or estimate basis. Anything else
// (a search, city, lender, owner, ...) uses the full table.
export function mapSimple(f: Filters) {
  return !f.q && !f.city && !f.lender?.length && f.minEbitda === undefined && f.maxEbitda === undefined
    && f.minEmp === undefined && f.maxEmp === undefined && !f.sell && !f.years && !f.owner && !f.phone && !f.email
    && !f.website && !f.contractor && !f.noFranchise && !f.area;
}

export function mapWhere(f: Filters) {
  const prefixes = SECTORS.find((s) => s.label === f.sector)?.prefixes;
  const conds = [sql`true`];
  if (prefixes) conds.push(sql`left(naics, 2) in ${sql(prefixes)}`);
  if (f.naics?.length) conds.push(sql`(${industryMatch(f.naics)})`);
  if (f.minRev !== undefined) conds.push(sql`est_revenue_mid >= ${f.minRev}`);
  if (f.maxRev !== undefined) conds.push(sql`est_revenue_mid <= ${f.maxRev}`);
  if (f.minValue !== undefined) conds.push(sql`est_value_mid >= ${f.minValue}`);
  if (f.maxValue !== undefined) conds.push(sql`est_value_mid <= ${f.maxValue}`);
  if (f.basis?.length) conds.push(sql`est_method in ${sql(f.basis.flatMap((b) => BASIS[b]))}`);
  if (f.noBranch) conds.push(sql`est_method <> 'branch'`);
  if (f.noNonprofit) conds.push(sql`not is_nonprofit`);
  if (f.bbox) {
    const [w, s, e, n] = f.bbox;
    conds.push(sql`lat between ${s} and ${n} and lon between ${w} and ${e}`);
  }
  return conds.reduce((acc, c) => sql`${acc} and ${c}`);
}

// Businesses in view from the per-square counts: only for a plain map view (or one sector), where
// the squares carry everything needed. Squares cut by the edge of the view count whole, so this is
// approximate; the list uses it only for large areas. Null when it doesn't apply.
export async function cellCount(f: Filters): Promise<number | null> {
  const plain = mapSimple(f) && !f.naics?.length && f.minRev === undefined && f.maxRev === undefined
    && f.minValue === undefined && f.maxValue === undefined && !f.basis?.length && !f.noNonprofit;
  if (!plain || !f.bbox) return null;
  const [w, s, e, n] = f.bbox;
  const prefixes = SECTORS.find((x) => x.label === f.sector)?.prefixes;
  const [r] = await sql`select coalesce(sum(n), 0)::int as n from map_cells
    where cx between ${Math.floor(w * 100)} and ${Math.floor(e * 100)} and cy between ${Math.floor(s * 100)} and ${Math.floor(n * 100)}
    ${prefixes ? sql`and sector in ${sql(prefixes)}` : sql``}`.catch(() => [null]);
  return r ? Number(r.n) : null;
}
