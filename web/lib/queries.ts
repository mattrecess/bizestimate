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
  if (f.q) conds.push(sql`(search @@ websearch_to_tsquery('simple', ${f.q}) or name ilike ${f.q + "%"})`);
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

// Never expose a street address for individuals (sole props, self-employed).
export const publicAddress = sql`case when is_individual then null else address end as address`;
