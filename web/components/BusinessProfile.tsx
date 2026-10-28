"use client";
import { useState } from "react";
import Link from "next/link";
import type { Business, Comparable, Headcount, LenderLink, Loan, Location } from "@/lib/business";
import { money, moneyRange } from "@/lib/format";
import ContactCard from "./ContactCard";
import SaveButton from "./SaveButton";
import PipelineBox from "./PipelineBox";
import HeadcountChart from "./HeadcountChart";
import PeopleAdvisors from "./PeopleAdvisors";
import PublicRecords, { type SourceRecord } from "./PublicRecords";
import { estimateValue } from "@/lib/valuation";
import { industryLabel, slug } from "@/lib/industries";
import Icon, { industryIcon } from "./Icon";
import MiniMap from "./MiniMap";
import RangeBar from "./RangeBar";

export type Profile = Business & { loans: Loan[]; comps?: Comparable[]; headcounts?: Headcount[]; sources?: SourceRecord[]; lenders?: LenderLink[]; locations?: Location[] };

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
const initials = (name: string) => name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

// Year of the first PPP loan (headcounts were reported then): 2020 for most, 2021 for second-draw-only.
const pppYear = (loans: Loan[]) => {
  const d = loans.find((l) => l.date_approved)?.date_approved;
  return d ? new Date(d).getFullYear() : 2020;
};

type Tab = "overview" | "financials" | "loans" | "comparables";

// Shared by the full business page and the explorer's side panel (compact: no mini-map).
export default function BusinessProfile({ b, compact = false, onSelect }: {
  b: Profile;
  compact?: boolean;
  onSelect?: (id: number) => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [copied, setCopied] = useState(false);
  const avg = b.est_method === "industry_average";           // no business-specific data at all
  const noLoan = !b.loans.length;
  const fromPlan = b.est_method === "retirement_plan";       // re-based on the newest Form 5500 count
  const reported = b.est_method === "reported";              // SEC, FDIC or Form 990 figures
  const src = Object.fromEntries((b.sources ?? []).map((s) => [s.source, s.data as Record<string, any>]));  // eslint-disable-line @typescript-eslint/no-explicit-any
  // The owner's own profile, only while it's for the owner we show (it was found for a name).
  const ownerLinkedIn = src.linkedin?.owner_url && src.linkedin.owner_name === b.owner_name ? src.linkedin.owner_url : null;
  const value = estimateValue({ ...b, public_company: !!src.sec || undefined, is_nonprofit: b.is_nonprofit || !!src.irs990 });
  // Earliest of the record-based year and the founding year the company's own site states.
  const founded = [src.founded?.year, src.fdic?.founded, src.fmcsa?.registered, src.website_profile?.founded_year]
    .filter((y): y is number => typeof y === "number").sort((a, b) => a - b)[0] ?? null;
  const ownershipChange = src.sba?.ownership_change_year ?? null;
  const latest = b.headcounts?.length ? b.headcounts[b.headcounts.length - 1] : null;
  // The margin actually applied (IRS industry margin adjusted for size) when the data has it.
  const irsMargin = b.est_ebitda_margin != null && b.est_method !== "owner_earnings";
  const margin = irsMargin ? b.est_ebitda_margin : b.ebitda_margin;
  const tabs: [Tab, string][] = [
    ["overview", "Overview"], ["financials", "How we estimated"],
    ...(b.loans.length ? [["loans", `PPP loans (${b.loans.length})`] as [Tab, string]] : []),
    ...(b.comps?.length ? [["comparables", "Comparables"] as [Tab, string]] : []),
  ];

  async function share() {
    const url = `${window.location.origin}/business/${b.id}`;
    try {
      if (navigator.share) await navigator.share({ title: b.name, url });
      else { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    } catch { /* share sheet dismissed */ }
  }

  return (
    <div className={compact ? "profile" : "profile full"}>
      <div className="p-head">
        <div className="ind-icon"><Icon name={industryIcon(b.naics)} size={24} /></div>
        <div>
          <h1>{b.name}</h1>
          <div className="sub">
            {[b.address, b.city, `OK ${b.zip}`].filter(Boolean).join(", ")}
          </div>
          <div className="badges">
            {industryLabel(b.naics)
              ? <a className="badge info" href={`/oklahoma/${slug(industryLabel(b.naics)!)}${b.city ? `/${slug(b.city)}` : ""}`}>{industryLabel(b.naics)}</a>
              : <span className="badge info">{b.industry}</span>}
            {b.est_method === "branch" ? <span className="badge">Branch location</span>
              : avg ? <span className="badge">Industry avg</span>
              : b.est_method === "verified" ? <span className="badge good">Verified financials</span>
              : reported ? <span className="badge good">Reported financials</span>
              : fromPlan ? <span className="badge good">401(k) plan data</span>
              : <span className="badge good">PPP loan data</span>}
            {src.website_profile?.family_owned && (
              <span className="badge good">Family-owned{src.website_profile.generation ? ` · gen ${src.website_profile.generation}` : ""}</span>
            )}
            {founded && <span className="badge" title={src.founded ? `Earliest record: ${src.founded.basis}` : undefined}>Since {founded}</span>}
            {ownershipChange && <span className="badge warn">New owners FY{ownershipChange}</span>}
            {src.sec && <span className="badge info">Public company</span>}
            {src.contracts && <span className="badge info">Federal contractor</span>}
            {b.is_nonprofit && <span className="badge">Nonprofit</span>}
          </div>
        </div>
      </div>

      <div className="actions">
        {b.website && (
          <a className="btn" href={b.website} target="_blank" rel="nofollow noopener noreferrer">
            <Icon name="globe" size={15} />{siteLabel(b.website)}
          </a>
        )}
        <a className="btn" href={src.linkedin?.company_url || linkedInSearch(b)} target="_blank" rel="nofollow noopener noreferrer">
          <Icon name="linkedin" size={15} />LinkedIn
        </a>
        <SaveButton id={String(b.id)} name={b.name} city={b.city} />
        <button className="btn" onClick={share}><Icon name="share" size={15} />{copied ? "Link copied" : "Share"}</button>
      </div>

      {b.owner_name && (
        <div className="owner-card">
          <div className="avatar">{initials(b.owner_name) || <Icon name="user" />}</div>
          <div>
            <div className="who">{b.owner_name}</div>
            <div className="src">
              {b.owner_title || "Owner"}
              {b.owner_source && <> · <a href={b.owner_source} target="_blank" rel="nofollow noopener noreferrer">source</a></>}
              {ownerLinkedIn && <> · <a href={ownerLinkedIn} target="_blank" rel="nofollow noopener noreferrer">LinkedIn</a></>}
            </div>
          </div>
        </div>
      )}

      <ContactCard id={String(b.id)} name={b.name} owner={b.owner_name} />
      <PipelineBox id={String(b.id)} />

      <div className="tabs" role="tablist">
        {tabs.map(([key, label]) => (
          <button key={key} role="tab" className="tab" aria-selected={tab === key} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      {tab === "overview" && b.sell_score != null && b.sell_signals?.length ? (
        <div className="sell-card">
          <div className="sell-head">
            <b>Likelihood to sell</b>
            <span className={`badge ${b.sell_score >= 40 ? "warn" : ""}`}>{b.sell_score >= 60 ? "High" : b.sell_score >= 40 ? "Elevated" : b.sell_score >= 20 ? "Some signs" : "Low"}</span>
          </div>
          <div className="sell-bar"><span style={{ width: `${b.sell_score}%` }} /></div>
          <ul>{b.sell_signals.map((s) => <li key={s}>{s}</li>)}</ul>
          <div className="sub">Signals from public records and the company&apos;s website, not a statement that it&apos;s for sale.</div>
        </div>
      ) : null}

      {tab === "overview" && b.est_method === "branch" && (
        <div className="branch-note">
          <Icon name="map" size={18} />
          <div>
            <b>A location of {b.parent_name}</b>
            <div className="sub">Revenue, EBITDA and value are for the whole company, on its profile.</div>
          </div>
          {b.parent_id && (onSelect
            ? <a className="btn primary" href={`/business/${b.parent_id}`} onClick={(e) => { e.preventDefault(); onSelect(Number(b.parent_id)); }}>View company</a>
            : <Link className="btn primary" href={`/business/${b.parent_id}`}>View company</Link>)}
        </div>
      )}

      {tab === "overview" && b.est_method !== "branch" && (
        <>
          {value && (
            <div className="value-banner">
              <div>
                <div className="k">Estimated business value</div>
                <div className="v">{money(value.mid)}</div>
              </div>
              <div className="value-meta">
                <span>{moneyRange(value.low, value.high)}</span>
                <span>about {value.multiple}× EBITDA</span>
              </div>
            </div>
          )}
          <div className="tiles">
            <div className="tile">
              <div className="k">Est. revenue</div>
              <div className="v">{money(b.est_revenue_mid)}</div>
              <RangeBar low={b.est_revenue_low} mid={b.est_revenue_mid} high={b.est_revenue_high} />
            </div>
            <div className="tile">
              <div className="k">Est. EBITDA</div>
              <div className="v">{money(b.est_ebitda_mid)}</div>
              <RangeBar low={b.est_ebitda_low} mid={b.est_ebitda_mid} high={b.est_ebitda_high} />
            </div>
            <div className="tile">
              <div className="k">Employees</div>
              {fromPlan && latest ? (
                <>
                  <div className="v">{latest.employees.toLocaleString()}</div>
                  <div className="r">In its retirement plan, {latest.year}{b.jobs_reported ? ` · ${b.jobs_reported} on PPP` : ""}</div>
                </>
              ) : (
                <>
                  <div className="v">{b.jobs_reported ?? "—"}</div>
                  <div className="r">{noLoan ? "No PPP loan on record" : "Reported to the SBA"}</div>
                </>
              )}
            </div>
            <div className="tile">
              <div className="k">{noLoan ? "Estimate basis" : "Total PPP"}</div>
              <div className="v">{noLoan ? (fromPlan ? "401(k) filing" : "Industry") : money(b.total_ppp_amount)}</div>
              <div className="r">
                <span className={`badge ${b.est_confidence === "low" ? "warn" : "good"}`}>{b.est_confidence} confidence</span>
              </div>
            </div>
          </div>
          {avg && (
            <p className="disclaimer">No PPP loan on record: these are typical figures for {b.industry} businesses in
              Oklahoma, not this business&apos;s own. <button className="link-btn" onClick={() => setTab("financials")}>How we estimate</button></p>
          )}
          <HeadcountChart
            ppp={b.jobs_reported && !noLoan ? { year: pppYear(b.loans), employees: b.jobs_reported } : null}
            plan={b.headcounts ?? []} revenuePerEmployee={b.revenue_per_employee} ebitdaMargin={margin} />
          <PeopleAdvisors sources={b.sources ?? []} owner={b.owner_name}
            lenders={[...b.loans.map((l) => l.lender), ...((src.sba?.loans ?? []) as { lender: string }[]).map((l) => l.lender)]} />
          {b.locations?.length ? (
            <div className="section">
              <h2><Icon name="map" size={16} />{b.locations.length + 1} locations</h2>
              <table><tbody>
                <tr><td><b>{b.address ?? b.city}</b></td><td>{b.city}</td><td className="num">This listing</td></tr>
                {b.locations.map((l) => (
                  <tr key={l.id}><td>{l.address ?? "—"}</td><td>{l.city}</td>
                    <td className="num">{onSelect
                      ? <a href={`/business/${l.id}`} onClick={(e) => { e.preventDefault(); onSelect(Number(l.id)); }}>View</a>
                      : <a href={`/business/${l.id}`}>View</a>}</td></tr>
                ))}
              </tbody></table>
              <p className="disclaimer">Revenue, EBITDA and value above are for the whole company.</p>
            </div>
          ) : null}
          {b.lenders?.length ? (
            <div className="section">
              <h2><Icon name="bank" size={16} />Banking relationships</h2>
              <table><tbody>
                {b.lenders.map((l) => (
                  <tr key={l.key}>
                    <td><b>{l.name}</b><div className="disclaimer" style={{ margin: 0 }}>{l.loans.join(", ")}</div></td>
                    <td className="num"><a href={`/?lender=${encodeURIComponent(l.key)}`}>{l.borrowers > 1 ? `All ${l.borrowers.toLocaleString()} borrowers` : "View"} →</a></td>
                  </tr>
                ))}
              </tbody></table>
              <p className="disclaimer">From PPP and SBA loan records, which name the bank but not the individual banker.</p>
            </div>
          ) : null}
          <PublicRecords sources={b.sources ?? []} />
          {!compact && b.lat != null && <div className="minimap"><MiniMap lat={Number(b.lat)} lon={Number(b.lon)} /></div>}
        </>
      )}

      {tab === "financials" && (
        <div className="section">
          <h2>How we estimated this</h2>
          {b.est_method === "employees" && (
            <table><tbody>
              <tr><td>Employees reported to the SBA</td><td className="num">{b.jobs_reported}</td></tr>
              <tr><td>Industry revenue per employee</td><td className="num">{money(b.revenue_per_employee)}</td></tr>
              <tr><td>Revenue = employees × revenue per employee</td><td className="num">{money(b.est_revenue_mid)}</td></tr>
              <tr><td>EBITDA margin{irsMargin ? " (industry, adjusted for size)" : " (industry)"}</td><td className="num">{pct(margin)}</td></tr>
              <tr><td>EBITDA = revenue × margin</td><td className="num">{money(b.est_ebitda_mid)}</td></tr>
              <tr><td>Cross-check: revenue implied by PPP payroll</td><td className="num">{money(b.est_revenue_by_payroll)}</td></tr>
            </tbody></table>
          )}
          {(Number(b.est_inflation) > 1.001 || Math.abs(Number(b.est_growth || 1) - 1) > 0.001) && (
            <p className="disclaimer">Brought up to date: {Number(b.est_inflation) > 1.001 && <>
              prices are {Math.round((Number(b.est_inflation) - 1) * 100)}% higher than in the benchmark&apos;s year</>}
              {Number(b.est_inflation) > 1.001 && Math.abs(Number(b.est_growth || 1) - 1) > 0.001 && " and "}
              {Math.abs(Number(b.est_growth || 1) - 1) > 0.001 && <>Oklahoma employment in this industry has
                {Number(b.est_growth) >= 1 ? " grown " : " fallen "}{Math.abs(Math.round((Number(b.est_growth) - 1) * 100))}% since 2020</>}
              , both included above.</p>
          )}
          {b.est_method === "payroll" && (
            <table><tbody>
              <tr><td colSpan={2}>No employee count was reported, so this uses the PPP loan instead.</td></tr>
              <tr><td>Annual payroll implied by PPP loan</td><td className="num">{money(b.est_payroll)}</td></tr>
              <tr><td>Industry payroll ÷ revenue</td><td className="num">{pct(b.payroll_to_revenue)}</td></tr>
              <tr><td>Revenue = payroll ÷ ratio</td><td className="num">{money(b.est_revenue_mid)}</td></tr>
              <tr><td>EBITDA margin{irsMargin ? " (industry, adjusted for size)" : " (industry)"}</td><td className="num">{pct(margin)}</td></tr>
            </tbody></table>
          )}
          {b.est_method === "owner_earnings" && (
            <p>This looks like a one-person business with no employee count. Its PPP loan was sized on owner earnings
              rather than payroll, so we treat the annualized amount as owner earnings (≈ EBITDA) and assume a 30% net
              margin to estimate revenue. Treat these numbers as rough.</p>
          )}
          {b.est_method === "verified" && (
            <p>These are the business&apos;s actual figures, provided to BizEstimate, not an estimate.</p>
          )}
          {reported && (
            <p>These are the business&apos;s own reported figures, from {src.sec ? "its SEC annual report (10-K)"
              : src.fdic ? "its FDIC call report" : "its IRS Form 990 filing"}, not an estimate.
              {!src.sec && !src.fdic && " EBITDA applies the industry margin to reported revenue."}</p>
          )}
          {value && (
            <table><tbody>
              <tr><td>Estimated value = EBITDA × typical sale multiple</td><td className="num">{money(value.mid)}</td></tr>
              <tr><td>Multiple for this size and industry</td><td className="num">{value.multiple}×</td></tr>
              <tr><td>Value range</td><td className="num">{moneyRange(value.low, value.high)}</td></tr>
            </tbody></table>
          )}
          {fromPlan && latest && (
            <table><tbody>
              <tr><td>Employees in its retirement plan ({latest.year} Form 5500)</td><td className="num">{latest.employees.toLocaleString()}</td></tr>
              <tr><td>Industry revenue per employee</td><td className="num">{money(b.revenue_per_employee)}</td></tr>
              <tr><td>Revenue = employees × revenue per employee</td><td className="num">{money(b.est_revenue_mid)}</td></tr>
              <tr><td>EBITDA margin{irsMargin ? " (industry, adjusted for size)" : " (industry)"}</td><td className="num">{pct(margin)}</td></tr>
              <tr><td>EBITDA = revenue × margin</td><td className="num">{money(b.est_ebitda_mid)}</td></tr>
              {b.jobs_reported ? <tr><td>For comparison: employees reported for PPP ({pppYear(b.loans)})</td><td className="num">{b.jobs_reported}</td></tr> : null}
            </tbody></table>
          )}
          {fromPlan && (
            <p className="disclaimer">Uses the newest headcount we have: participants in the company&apos;s retirement plan from its
              Form 5500 filing with the Department of Labor. Plans can leave out part-timers and new hires, so the range
              leans higher than the estimate.</p>
          )}
          {avg && (
            <p>This business has no PPP loan on record, so there is no business-specific data. The figures are the
              typical estimated revenue of {b.industry} businesses in our Oklahoma data: the middle value, with the
              range covering the middle half of those businesses. EBITDA applies the industry margin
              ({pct(margin)}). Treat these as a rough guide.</p>
          )}
          <table><tbody>
            <tr><td>Revenue range</td><td className="num">{moneyRange(b.est_revenue_low, b.est_revenue_high)}</td></tr>
            <tr><td>EBITDA range</td><td className="num">{moneyRange(b.est_ebitda_low, b.est_ebitda_high)}</td></tr>
            <tr><td>Industry (NAICS)</td><td className="num">{b.industry} ({b.naics ? <a href={`/?q=${b.naics}`} title="Every business with this NAICS code">{b.naics}</a> : "n/a"})</td></tr>
          </tbody></table>
          {b.est_confidence === "low" && b.est_method === "employees" && (
            <p className="disclaimer">Low confidence: the employee-based and payroll-based estimates differ by more than 2×.</p>
          )}
          {irsMargin && (
            <p className="disclaimer">EBITDA margin: from IRS tax returns of S corporations in this industry (2019–2022),
              adjusted for company size: smaller companies typically run higher margins. EBITDA here is after
              owners&apos; salaries.</p>
          )}
          <p className="disclaimer">Benchmarks: {b.benchmark_source ?? "sector default"}.
            {!fromPlan && !avg && " PPP loans were sized on 2019–2020 payroll, so figures reflect that period."} These are
            statistical estimates, not reported financials.
            {noLoan && " Listing details come from Overture Maps open data."}{" "}
            <Link href="/methodology">Full methodology</Link></p>
        </div>
      )}

      {tab === "loans" && (
        <div className="section">
          <h2>PPP loans</h2>
          <table>
            <thead><tr><th>Approved</th><th>Draw</th><th className="num">Amount</th><th className="num hide-sm">Forgiven</th><th className="num">Jobs</th><th className="hide-sm">Lender</th></tr></thead>
            <tbody>
              {b.loans.map((l) => (
                <tr key={l.loan_number}>
                  <td>{l.date_approved ? new Date(l.date_approved).toLocaleDateString() : "—"}</td>
                  <td>{l.draw}</td><td className="num">{money(l.amount)}</td>
                  <td className="num hide-sm">{money(l.forgiveness_amount)}</td>
                  <td className="num">{l.jobs_reported ?? "—"}</td><td className="hide-sm">{l.lender}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "comparables" && (
        <div className="section">
          <h2>Similar businesses nearby</h2>
          <table>
            <thead><tr><th>Business</th><th className="num">Est. revenue</th><th className="num hide-sm">Est. EBITDA</th><th className="num">Distance</th></tr></thead>
            <tbody>
              {(b.comps ?? []).map((c) => (
                <tr key={c.id}>
                  <td>
                    {onSelect
                      ? <a href={`/business/${c.id}`} onClick={(e) => { e.preventDefault(); onSelect(Number(c.id)); }}>{c.name}</a>
                      : <Link href={`/business/${c.id}`}>{c.name}</Link>}
                    <div className="disclaimer" style={{ margin: 0 }}>{c.city}{c.jobs_reported ? ` · ${c.jobs_reported} employees` : ""}</div>
                  </td>
                  <td className="num">{money(c.est_revenue_mid)}</td>
                  <td className="num hide-sm">{money(c.est_ebitda_mid)}</td>
                  <td className="num">{c.miles == null ? "—" : `${Number(c.miles).toFixed(1)} mi`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
