import { sql } from "./db";
import { SECTORS } from "./sectors";

export type Filters = {
  q?: string;
  sector?: string;
  city?: string;
  minRev?: number;
  maxRev?: number;
  bbox?: [number, number, number, number]; // west, south, east, north
};

export function parseFilters(p: URLSearchParams): Filters {
  const num = (k: string) => (p.get(k) ? Number(p.get(k)) : undefined);
  const bbox = p.get("bbox")?.split(",").map(Number);
  return {
    q: p.get("q")?.trim() || undefined,
    sector: p.get("sector") || undefined,
    city: p.get("city")?.trim() || undefined,
    minRev: num("min_rev"),
    maxRev: num("max_rev"),
    bbox: bbox?.length === 4 && bbox.every(Number.isFinite) ? (bbox as Filters["bbox"]) : undefined,
  };
}

export function where(f: Filters) {
  const prefixes = SECTORS.find((s) => s.label === f.sector)?.prefixes;
  const conds = [sql`true`];
  // Every word of the query starts a word of the name ("tru solutions" -> TRUE SOLUTIONS ...,
  // "jk janitorial" -> J K JANITORIAL), or the name is a close misspelling of the query.
  if (f.q) {
    const words = queryWords(f.q);
    const allWords = words.length ? words.map(wordMatch).reduce((a, b) => sql`${a} and ${b}`) : sql`false`;
    // Each branch is index-backed (tsvector, name_norm trigrams, name trigrams via <%) so a search
    // touches only candidate rows instead of scanning every business.
    conds.push(sql`(search @@ websearch_to_tsquery('simple', ${f.q}) or (${allWords})
      or (${f.q} <% name and word_similarity(${f.q}, name) >= 0.8))`);
  }
  if (prefixes) conds.push(sql`left(naics, 2) in ${sql(prefixes)}`);
  if (f.city) conds.push(sql`lower(city) = lower(${f.city})`);
  if (f.minRev !== undefined) conds.push(sql`est_revenue_mid >= ${f.minRev}`);
  if (f.maxRev !== undefined) conds.push(sql`est_revenue_mid <= ${f.maxRev}`);
  if (f.bbox) {
    const [w, s, e, n] = f.bbox;
    conds.push(sql`lat between ${s} and ${n} and lon between ${w} and ${e}`);
  }
  return conds.reduce((acc, c) => sql`${acc} and ${c}`);
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
  if (!f.q) return sql``;
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
