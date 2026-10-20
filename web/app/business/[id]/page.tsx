import { notFound } from "next/navigation";
import { getBusiness } from "@/lib/business";
import { money, moneyRange } from "@/lib/format";
import ClaimForm from "@/components/ClaimForm";
import MiniMap from "@/components/MiniMap";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const b = await getBusiness((await params).id);
  return { title: b ? `${b.name} — estimated revenue | BizEstimate` : "Not found" };
}

export default async function BusinessPage({ params }: { params: Promise<{ id: string }> }) {
  const b = await getBusiness((await params).id);
  if (!b) notFound();
  const pct = (v: unknown) => (v == null ? "—" : `${(Number(v) * 100).toFixed(0)}%`);

  return (
    <main className="page">
      <div className="hero">
        <h1>{b.name}</h1>
        <div className="sub">
          {[b.address, b.city, `OK ${b.zip}`].filter(Boolean).join(", ")} · {b.industry} (NAICS {b.naics || "n/a"})
          {b.is_nonprofit && " · Nonprofit"}
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="k">Estimated revenue</div>
          <div className="v">{money(b.est_revenue_mid)}</div>
          <div className="r">{moneyRange(b.est_revenue_low, b.est_revenue_high)}</div>
        </div>
        <div className="stat">
          <div className="k">Estimated EBITDA</div>
          <div className="v">{money(b.est_ebitda_mid)}</div>
          <div className="r">{moneyRange(b.est_ebitda_low, b.est_ebitda_high)}</div>
        </div>
        <div className="stat">
          <div className="k">Employees (reported to SBA)</div>
          <div className="v">{b.jobs_reported ?? "—"}</div>
          <div className="r">Total PPP: {money(b.total_ppp_amount)}</div>
        </div>
      </div>

      <div className="section">
        <h2>How we estimated this <span className={`badge ${b.est_confidence === "low" ? "low" : ""}`}>{b.est_confidence} confidence</span></h2>
        {b.est_method === "payroll" ? (
          <table><tbody>
            <tr><td>Annual payroll implied by PPP loan</td><td>{money(b.est_payroll)}</td></tr>
            <tr><td>Industry payroll ÷ revenue</td><td>{pct(b.payroll_to_revenue)}</td></tr>
            <tr><td>Revenue = payroll ÷ ratio</td><td>{money(b.est_revenue_mid)}</td></tr>
            <tr><td>Industry EBITDA margin</td><td>{pct(b.ebitda_margin)}</td></tr>
            <tr><td>Cross-check: employees × industry revenue per employee</td><td>{money(b.est_revenue_by_employees)}</td></tr>
          </tbody></table>
        ) : (
          <p>This looks like a one-person business. Its PPP loan was sized on owner earnings rather than
            payroll, so we treat the annualized amount as owner earnings (≈ EBITDA) and assume a 30% net margin to
            estimate revenue. Treat these numbers as rough.</p>
        )}
        <p className="disclaimer">Benchmarks: {b.benchmark_source ?? "sector default"}. PPP loans were sized on 2019–2020
          payroll, so figures reflect that period. These are statistical estimates, not reported financials.</p>
      </div>

      <div className="section">
        <h2>PPP loans</h2>
        <table>
          <thead><tr><th>Approved</th><th>Draw</th><th>Amount</th><th>Forgiven</th><th>Jobs</th><th>Lender</th></tr></thead>
          <tbody>
            {b.loans.map((l) => (
              <tr key={l.loan_number}>
                <td>{l.date_approved ? new Date(l.date_approved).toLocaleDateString() : "—"}</td>
                <td>{l.draw}</td><td>{money(l.amount)}</td><td>{money(l.forgiveness_amount)}</td>
                <td>{l.jobs_reported ?? "—"}</td><td>{l.lender}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {b.lat != null && <div className="minimap"><MiniMap lat={Number(b.lat)} lon={Number(b.lon)} /></div>}

      <div className="section">
        <h2>Own this business?</h2>
        <p style={{ color: "var(--muted)", marginTop: 0 }}>Claim this listing to correct the numbers or request removal.</p>
        <ClaimForm businessId={Number(b.id)} />
      </div>
    </main>
  );
}
