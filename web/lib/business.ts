import { sql } from "./db";
import { publicAddress } from "./queries";

type Num = string | number | null;
export type Business = {
  id: string; name: string; address: string | null; city: string; state: string; zip: string;
  county: string; naics: string; industry: string; business_type: string; is_individual: boolean;
  is_nonprofit: boolean; jobs_reported: number | null; lat: number | null; lon: number | null;
  geo_precision: string | null; est_payroll: Num; est_revenue_low: Num; est_revenue_mid: Num;
  est_revenue_high: Num; est_ebitda_low: Num; est_ebitda_mid: Num; est_ebitda_high: Num;
  est_revenue_by_employees: Num; est_method: string; est_confidence: string; total_ppp_amount: Num;
  payroll_to_revenue: Num; ebitda_margin: Num; benchmark_source: string | null;
};
export type Loan = {
  loan_number: string; draw: string; date_approved: Date | null; amount: Num;
  forgiveness_amount: Num; loan_status: string; lender: string; jobs_reported: number | null;
};

export async function getBusiness(id: string): Promise<(Business & { loans: Loan[] }) | null> {
  if (!/^\d+$/.test(id)) return null;
  const [biz] = await sql<Business[]>`
    select b.id, b.name, ${publicAddress}, b.city, b.state, b.zip, b.county, b.naics, b.industry,
           b.business_type, b.is_individual, b.is_nonprofit, b.jobs_reported, b.lat, b.lon,
           b.geo_precision, b.est_payroll, b.est_revenue_low, b.est_revenue_mid, b.est_revenue_high,
           b.est_ebitda_low, b.est_ebitda_mid, b.est_ebitda_high, b.est_revenue_by_employees,
           b.est_method, b.est_confidence, b.total_ppp_amount,
           ib.payroll_to_revenue, ib.ebitda_margin, ib.source as benchmark_source
    from businesses b
    left join lateral (
      select * from industry_benchmarks
      where b.naics like naics_prefix || '%' order by length(naics_prefix) desc limit 1
    ) ib on true
    where b.id = ${id}`;
  if (!biz) return null;
  const loans = await sql<Loan[]>`
    select loan_number, draw, date_approved, amount, forgiveness_amount, loan_status, lender, jobs_reported
    from ppp_loans where business_id = ${id} order by date_approved`;
  return { ...biz, loans };
}
