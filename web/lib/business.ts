import { sql } from "./db";
import { industryMatch, publicAddress } from "./queries";
import { matchIndustry } from "./industries";

type Num = string | number | null;
export type Business = {
  id: string; name: string; address: string | null; city: string; state: string; zip: string;
  county: string; naics: string; industry: string; business_type: string; is_individual: boolean;
  is_nonprofit: boolean; jobs_reported: number | null; lat: number | null; lon: number | null;
  geo_precision: string | null; est_payroll: Num; est_revenue_low: Num; est_revenue_mid: Num;
  est_revenue_high: Num; est_ebitda_low: Num; est_ebitda_mid: Num; est_ebitda_high: Num;
  est_revenue_by_employees: Num; est_revenue_by_payroll: Num; est_method: string; est_confidence: string; total_ppp_amount: Num; key_source?: string;
  est_value_mid?: Num; est_calibration?: Num; est_growth_rate?: Num;
  website: string | null; owner_name: string | null; owner_title: string | null;
  owner_source: string | null; payroll_to_revenue: Num; revenue_per_employee: Num; ebitda_margin: Num; benchmark_source: string | null;
  est_ebitda_margin: Num; est_inflation: Num; est_growth: Num;
  parent_name: string | null; parent_id: string | null;
  sell_score: number | null; sell_signals: string[] | null;
};
export type Loan = {
  loan_number: string; draw: string; date_approved: Date | null; amount: Num;
  forgiveness_amount: Num; loan_status: string; lender: string; jobs_reported: number | null;
};

export type Headcount = { year: number; employees: number };

export async function getBusinessRow(id: string): Promise<Business | null> {
  if (!/^\d+$/.test(id)) return null;
  const [biz] = await sql<Business[]>`
    select b.id, b.name, ${publicAddress}, b.city, b.state, b.zip, b.county, b.naics, b.industry,
           b.business_type, b.is_individual, b.is_nonprofit, b.jobs_reported, b.lat, b.lon,
           b.geo_precision, b.est_payroll, b.est_revenue_low, b.est_revenue_mid, b.est_revenue_high,
           b.est_ebitda_low, b.est_ebitda_mid, b.est_ebitda_high, b.est_revenue_by_employees, b.est_revenue_by_payroll,
           b.est_method, b.est_confidence, b.total_ppp_amount, split_part(b.biz_key, '|', 1) as key_source,
           -- via to_jsonb: tolerant of databases loaded before these columns existed
           to_jsonb(b) ->> 'website' as website, to_jsonb(b) ->> 'owner_name' as owner_name,
           to_jsonb(b) ->> 'owner_title' as owner_title, to_jsonb(b) ->> 'owner_source' as owner_source,
           to_jsonb(b) ->> 'est_ebitda_margin' as est_ebitda_margin,
           to_jsonb(b) ->> 'est_inflation' as est_inflation, to_jsonb(b) ->> 'est_growth' as est_growth,
           to_jsonb(b) ->> 'est_value_mid' as est_value_mid, to_jsonb(b) ->> 'est_calibration' as est_calibration,
           to_jsonb(b) ->> 'est_growth_rate' as est_growth_rate,
           to_jsonb(b) ->> 'parent_name' as parent_name,
           (to_jsonb(b) ->> 'sell_score')::int as sell_score, to_jsonb(b) -> 'sell_signals' as sell_signals,
           (select p.id from businesses p where p.biz_key = to_jsonb(b) ->> 'parent_key') as parent_id,
           ib.payroll_to_revenue, ib.revenue_per_employee, ib.ebitda_margin, ib.source as benchmark_source
    from businesses b
    left join lateral (
      select * from industry_benchmarks
      where b.naics like naics_prefix || '%' order by length(naics_prefix) desc limit 1
    ) ib on true
    where b.id = ${id}`;
  return biz ?? null;
}

// Everything a profile shows. After the business row, the rest load side by side.
export async function getProfile(id: string) {
  const biz = await getBusinessRow(id);
  if (!biz) return null;
  const [core, related] = await Promise.all([coreParts(id), relatedParts(biz)]);
  return { ...biz, ...core, ...related };
}

// The quick part (indexed lookups by business): what the side panel shows first.
export async function getProfileCore(id: string) {
  const biz = await getBusinessRow(id);
  if (!biz) return null;
  return { ...biz, ...(await coreParts(id)) };
}

async function coreParts(id: string) {
  const [loans, headcounts, sources, transactions] = await Promise.all([getLoans(id), getHeadcounts(id), getSources(id), getTransactions(id)]);
  return { loans, headcounts, sources, transactions };
}

// Public ownership transactions (acquisitions, investments); price and multiple only when marked public.
export type Transaction = { deal_date: string | null; buyer: string; deal_type: string; summary: string | null; source_url: string | null };
const getTransactions = (id: string) => sql<Transaction[]>`
  select to_char(t.deal_date, 'YYYY-MM-DD') as deal_date, t.buyer, t.deal_type, t.summary, t.source_url
  from transactions t join businesses b on b.biz_key = t.biz_key
  where b.id = ${id} and t.is_public order by t.deal_date desc nulls last`.catch(() => [] as Transaction[]);

// The slower part (comparables search, bank and location roll-ups), loaded just after.
export async function relatedParts(biz: Business, opts: { locations?: boolean } = {}) {
  const [comps, lenders, locations, prospects] = await Promise.all([
    getComparables(biz), getLenders(biz.id), opts.locations === false ? Promise.resolve([] as Location[]) : getLocations(biz.id),
    getProspects(biz)]);
  return { comps, lenders, locations, prospects };
}

// Possible customers: the largest businesses near this one in the industries its own website says it
// serves ("hospitals", "oil and gas", "restaurants"), matched to industries the way search does.
export type Prospect = { id: string; name: string; city: string; industry: string; est_revenue_mid: Num; miles: number | null };
async function getProspects(b: Business): Promise<{ market: string; items: Prospect[] }[]> {
  const [row] = await sql`select s.data -> 'markets' as markets from business_sources s join businesses x on x.biz_key = s.biz_key
                          where x.id = ${b.id} and s.source = 'website_offering'`.catch(() => []);
  const markets: string[] = Array.isArray(row?.markets) ? row.markets : [];
  const lat = b.lat == null ? null : Number(b.lat), lon = b.lon == null ? null : Number(b.lon);
  const out: { market: string; items: Prospect[] }[] = [];
  const seen = new Set<string>();
  for (const market of markets.slice(0, 6)) {
    const m = matchIndustry(market);
    if (!m || seen.has(m.industry.label) || b.naics && m.industry.naics.some((c) => b.naics!.startsWith(c))) continue;
    seen.add(m.industry.label);
    const near = lat == null ? sql`city = ${b.city}` : sql`lat between ${lat - 0.9} and ${lat + 0.9} and lon between ${lon! - 1.1} and ${lon! + 1.1}`;
    const items = await sql<Prospect[]>`
      select id, name, city, industry, est_revenue_mid,
             ${lat == null ? sql`null::float8` : sql`round((69.0 * sqrt(power(lat - ${lat}, 2) + power((lon - ${lon}) * cos(radians(${lat})), 2)))::numeric, 0)::float8`} as miles
      from businesses where (${industryMatch(m.industry.naics)}) and ${near} and not is_individual and coalesce(est_method, '') <> 'branch'
      order by est_revenue_mid desc nulls last limit 5`.catch(() => [] as Prospect[]);
    if (items.length) out.push({ market: m.industry.label, items });
    if (out.length >= 4) break;
  }
  return out;
}

const getLoans = (id: string) => sql<Loan[]>`
  select loan_number, draw, date_approved, amount, forgiveness_amount, loan_status, lender, jobs_reported
  from ppp_loans where business_id = ${id} order by date_approved`;

// Public records matched to the business (SEC, Form 990, FDIC, SBA loans, contracts, DOT, OSHA).
export type SourceRecord = { source: string; data: Record<string, unknown> };
const getSources = (id: string) => sql<SourceRecord[]>`
  -- Contact details stay out of the profile; they load on request from /api/contact.
  select s.source, s.data - 'phone' - 'email' as data from business_sources s join businesses b on b.biz_key = s.biz_key
  where b.id = ${id} order by s.source`.catch(() => [] as SourceRecord[]);

// The company's other locations (map listings rolled up to it).
export type Location = { id: string; address: string | null; city: string };
const getLocations = (id: string) => sql<Location[]>`
  select c.id, c.address, c.city from businesses c join businesses p on c.parent_key = p.biz_key
  where p.id = ${id} order by c.city, c.address`.catch(() => [] as Location[]);

// Banks that lent to the business, with how many other listed businesses each one lends to.
export type LenderLink = { key: string; name: string; loans: string[]; borrowers: number };
const getLenders = (id: string) => sql<LenderLink[]>`
  select bl.lender_key as key, min(bl.lender) as name,
         array_agg(distinct concat_ws(' ', bl.program, bl.year)) as loans,
         (select count(distinct x.business_id)::int from business_lenders x where x.lender_key = bl.lender_key) as borrowers
  from business_lenders bl where bl.business_id = ${id} group by bl.lender_key order by name`.catch(() => [] as LenderLink[]);

// Retirement-plan participants by year (Form 5500); empty until that table has been loaded.
const getHeadcounts = (id: string) => sql<Headcount[]>`
  select h.year, h.employees from headcounts h join businesses b on b.biz_key = h.biz_key
  where b.id = ${id} and h.source = 'form5500' order by h.year`.catch(() => [] as Headcount[]);

export type Comparable = {
  id: string; name: string; city: string; industry: string; jobs_reported: number | null;
  est_revenue_mid: Num; est_ebitda_mid: Num; miles: number | null;
};

// Nearest businesses in the same industry (4-digit NAICS, falling back to the 2-digit sector).
export async function getComparables(b: Business, limit = 6): Promise<Comparable[]> {
  if (!b.naics) return [];
  const lat = b.lat == null ? null : Number(b.lat);
  const lon = b.lon == null ? null : Number(b.lon);
  // Nearby first (within about 50 miles, so only that area is measured and sorted), then statewide.
  const tries = [b.naics.slice(0, 4), b.naics.slice(0, 2)].flatMap((prefix) => [{ prefix, near: true }, { prefix, near: false }]);
  for (const { prefix, near } of tries) {
    if (near && lat == null) continue;
    const distance = lat == null
      ? sql`null::float8`
      : sql`69.0 * sqrt(power(lat - ${lat}, 2) + power((lon - ${lon}) * cos(radians(${lat})), 2))`;
    const rows = await sql<Comparable[]>`
      select id, name, city, industry, jobs_reported, est_revenue_mid, est_ebitda_mid, ${distance} as miles
      from businesses
      where naics like ${prefix + "%"} and id <> ${b.id} and est_revenue_mid is not null
        and coalesce(est_method, '') <> 'branch'
        ${lat == null ? sql`and city = ${b.city}` : near
          ? sql`and lat between ${lat! - 0.75} and ${lat! + 0.75} and lon between ${lon! - 0.9} and ${lon! + 0.9}`
          : sql`and lat is not null`}
      order by ${lat == null ? sql`est_revenue_mid desc` : sql`miles`}
      limit ${limit}`;
    if (rows.length >= 3 || (prefix.length === 2 && !near)) return rows;
  }
  return [];
}
