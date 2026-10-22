import Link from "next/link";
import type { Business, Comparable, Loan } from "@/lib/business";
import { money, moneyRange } from "@/lib/format";
import ClaimForm from "./ClaimForm";
import MiniMap from "./MiniMap";

export type Profile = Business & { loans: Loan[]; comps: Comparable[] };

// "https://www.blastrac.com/" -> "blastrac.com"
function siteLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Website";
  }
}

// People search for the owner at this business when we know a name, otherwise a company search.
function linkedInSearch(b: Profile) {
  const name = b.name.replace(/,?\s+(LLC|L\.L\.C\.|INC\.?|CORP\.?|CO\.?|PLLC|LTD\.?)$/i, "");
  return b.owner_name
    ? `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${b.owner_name} ${name}`)}`
    : `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(name)}`;
}

const pct = (v: unknown) => (v == null ? "—" : `${(Number(v) * 100).toFixed(0)}%`);

// Shared by the full business page and the explorer's side panel (compact, no mini-map).
export default function BusinessProfile({ b, compact = false, onSelect }: {
  b: Profile;
  compact?: boolean;
  onSelect?: (id: number) => void;
}) {
  const comps = b.comps;
  return (
    <div className={compact ? "profile compact" : "profile"}>
      <div className="hero">
        <h1>{b.name}</h1>
        <div className="sub">
          {[b.address, b.city, `OK ${b.zip}`].filter(Boolean).join(", ")} · {b.industry} (NAICS {b.naics || "n/a"})
          {b.is_nonprofit && " · Nonprofit"}
        </div>
        {b.owner_name && (
          <div className="owner">
            {b.owner_title || "Owner"}: <strong>{b.owner_name}</strong>
            {b.owner_source && (
              <> · <a href={b.owner_source} target="_blank" rel="nofollow noopener noreferrer">source</a></>
            )}
          </div>
        )}
        <div className="links">
          {b.website && (
            <a href={b.website} target="_blank" rel="nofollow noopener noreferrer">{siteLabel(b.website)} ↗</a>
          )}
          <a href={linkedInSearch(b)} target="_blank" rel="nofollow noopener noreferrer">Find on LinkedIn ↗</a>
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
        {b.est_method === "employees" && (
          <table><tbody>
            <tr><td>Employees reported to the SBA</td><td>{b.jobs_reported}</td></tr>
            <tr><td>Industry revenue per employee</td><td>{money(b.revenue_per_employee)}</td></tr>
            <tr><td>Revenue = employees × revenue per employee</td><td>{money(b.est_revenue_mid)}</td></tr>
            <tr><td>Industry EBITDA margin</td><td>{pct(b.ebitda_margin)}</td></tr>
            <tr><td>EBITDA = revenue × margin</td><td>{money(b.est_ebitda_mid)}</td></tr>
            <tr><td>Cross-check: revenue implied by PPP payroll</td><td>{money(b.est_revenue_by_payroll)}</td></tr>
          </tbody></table>
        )}
        {b.est_method === "payroll" && (
          <table><tbody>
            <tr><td colSpan={2}>No employee count was reported, so this uses the PPP loan instead.</td></tr>
            <tr><td>Annual payroll implied by PPP loan</td><td>{money(b.est_payroll)}</td></tr>
            <tr><td>Industry payroll ÷ revenue</td><td>{pct(b.payroll_to_revenue)}</td></tr>
            <tr><td>Revenue = payroll ÷ ratio</td><td>{money(b.est_revenue_mid)}</td></tr>
            <tr><td>Industry EBITDA margin</td><td>{pct(b.ebitda_margin)}</td></tr>
          </tbody></table>
        )}
        {b.est_method === "owner_earnings" && (
          <p>This looks like a one-person business with no employee count. Its PPP loan was sized on owner earnings
            rather than payroll, so we treat the annualized amount as owner earnings (≈ EBITDA) and assume a 30% net
            margin to estimate revenue. Treat these numbers as rough.</p>
        )}
        {b.est_confidence === "low" && b.est_method === "employees" && (
          <p className="disclaimer">Low confidence: the employee-based and payroll-based estimates differ by more than 2×.</p>
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

      {comps.length > 0 && (
        <div className="section">
          <h2>Comparable businesses nearby</h2>
          <table>
            <thead><tr><th>Business</th><th className="hide-sm">City</th><th className="hide-sm">Employees</th><th>Est. revenue</th><th>Est. EBITDA</th><th>Distance</th></tr></thead>
            <tbody>
              {comps.map((c) => (
                <tr key={c.id}>
                  <td>{onSelect
                    ? <a href={`/business/${c.id}`} onClick={(e) => { e.preventDefault(); onSelect(Number(c.id)); }}>{c.name}</a>
                    : <Link href={`/business/${c.id}`}>{c.name}</Link>}</td>
                  <td className="hide-sm">{c.city}</td><td className="hide-sm">{c.jobs_reported ?? "—"}</td>
                  <td>{money(c.est_revenue_mid)}</td><td>{money(c.est_ebitda_mid)}</td>
                  <td>{c.miles == null ? "—" : `${Number(c.miles).toFixed(1)} mi`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!compact && b.lat != null && <div className="minimap"><MiniMap lat={Number(b.lat)} lon={Number(b.lon)} /></div>}

      <div className="section">
        <h2>Own this business?</h2>
        <p style={{ color: "var(--muted)", marginTop: 0 }}>Claim this listing to correct the numbers or request removal.</p>
        <ClaimForm key={b.id} businessId={Number(b.id)} />
      </div>
    </div>
  );
}
