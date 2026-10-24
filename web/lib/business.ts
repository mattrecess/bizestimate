import { sql } from "./db";
import { publicAddress } from "./queries";

type Num = string | number | null;
export type Business = {
  id: string; name: string; address: string | null; city: string; state: string; zip: string;
  county: string; naics: string; industry: string; business_type: string; is_individual: boolean;
  is_nonprofit: boolean; jobs_reported: number | null; lat: number | null; lon: number | null;
  geo_precision: string | null; est_payroll: Num; est_revenue_low: Num; est_revenue_mid: Num;
  est_revenue_high: Num; est_ebitda_low: Num; est_ebitda_mid: Num; est_ebitda_high: Num;
  est_revenue_by_employees: Num; est_revenue_by_payroll: Num; est_method: string; est_confidence: string; total_ppp_amount: Num;
  website: string | null; owner_name: string | null; owner_title: string | null;
  owner_source: string | null; payroll_to_revenue: Num; revenue_per_employee: Num; ebitda_margin: Num; benchmark_source: string | null;
  est_ebitda_margin: Num;
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
           b.est_method, b.est_confidence, b.total_ppp_amount,
           -- via to_jsonb: tolerant of databases loaded before these columns existed
           to_jsonb(b) ->> 'website' as website, to_jsonb(b) ->> 'owner_name' as owner_name,
           to_jsonb(b) ->> 'owner_title' as owner_title, to_jsonb(b) ->> 'owner_source' as owner_source,
           to_jsonb(b) ->> 'est_ebitda_margin' as est_ebitda_margin,
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
  const [loans, headcounts, comps] = await Promise.all([getLoans(id), getHeadcounts(id), getComparables(biz)]);
  return { ...biz, loans, headcounts, comps };
}

const getLoans = (id: string) => sql<Loan[]>`
  select loan_number, draw, date_approved, amount, forgiveness_amount, loan_status, lender, jobs_reported
  from ppp_loans where business_id = ${id} order by date_approved`;

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
  for (const prefix of [b.naics.slice(0, 4), b.naics.slice(0, 2)]) {
    const distance = lat == null
      ? sql`null::float8`
      : sql`69.0 * sqrt(power(lat - ${lat}, 2) + power((lon - ${lon}) * cos(radians(${lat})), 2))`;
    const rows = await sql<Comparable[]>`
      select id, name, city, industry, jobs_reported, est_revenue_mid, est_ebitda_mid, ${distance} as miles
      from businesses
      where naics like ${prefix + "%"} and id <> ${b.id} and est_revenue_mid is not null
        ${lat == null ? sql`and city = ${b.city}` : sql`and lat is not null`}
      order by ${lat == null ? sql`est_revenue_mid desc` : sql`miles`}
      limit ${limit}`;
    if (rows.length >= 3 || prefix.length === 2) return rows;
  }
  return [];
}
