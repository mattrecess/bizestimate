import Link from "next/link";
import Footer from "@/components/Footer";
import { compareRows, type CompareRow } from "@/lib/compare";
import { money, moneyRange } from "@/lib/format";
import { estimateValue } from "@/lib/valuation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Compare businesses | BizEstimate", robots: { index: false, follow: true } };

const METHOD: Record<string, string> = {
  employees: "PPP headcount", payroll: "PPP payroll", retirement_plan: "401(k) headcount", reported: "Reported figures",
  verified: "Verified figures", industry_average: "Industry average", owner_earnings: "Owner earnings", branch: "Branch location",
};

const ROWS: [string, (r: CompareRow) => React.ReactNode][] = [
  ["City", (r) => r.city],
  ["Industry", (r) => r.industry],
  ["Revenue", (r) => <><b>{money(r.est_revenue_mid)}</b><div className="disclaimer" style={{ margin: 0 }}>{moneyRange(r.est_revenue_low, r.est_revenue_high)}</div></>],
  ["EBITDA", (r) => <><b>{money(r.est_ebitda_mid)}</b><div className="disclaimer" style={{ margin: 0 }}>{moneyRange(r.est_ebitda_low, r.est_ebitda_high)}</div></>],
  ["EBITDA margin", (r) => (Number(r.est_revenue_mid) > 0 && r.est_ebitda_mid ? `${Math.round((100 * Number(r.est_ebitda_mid)) / Number(r.est_revenue_mid))}%` : "—")],
  ["Value", (r) => { const v = estimateValue(r); return v ? <>{money(v.mid)}<div className="disclaimer" style={{ margin: 0 }}>{v.multiple}× EBITDA</div></> : "—"; }],
  ["Employees", (r) => (r.employees_latest ? `${r.employees_latest} (${r.employees_year})` : r.jobs_reported ? `${r.jobs_reported} (2020)` : "—")],
  ["Founded", (r) => r.founded ?? "—"],
  ["Owner", (r) => r.owner_name ?? "—"],
  ["Likely to sell", (r) => (r.sell_score == null ? "—" : `${r.sell_score}/100`)],
  ["Based on", (r) => METHOD[r.est_method] ?? r.est_method],
];

export default async function Compare({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const ids = ((await searchParams).ids ?? "").split(",").filter((s) => /^\d+$/.test(s)).slice(0, 5);
  const rows = await compareRows(ids);
  return (
    <>
      <main className="page compare">
        <h1>Compare businesses</h1>
        {rows.length < 2 ? <p>Pick two to five businesses on your <Link href="/saved">Saved</Link> page to compare them.</p> : (
          <div className="section">
            <table>
              <thead><tr><th />{rows.map((r) => <th key={r.id}><Link href={`/business/${r.id}`}>{r.name}</Link></th>)}</tr></thead>
              <tbody>
                {ROWS.map(([label, f]) => <tr key={label}><td className="k">{label}</td>{rows.map((r) => <td key={r.id}>{f(r)}</td>)}</tr>)}
              </tbody>
            </table>
          </div>
        )}
        <p className="disclaimer">All figures are estimates from public data unless marked reported or verified.</p>
      </main>
      <Footer />
    </>
  );
}
