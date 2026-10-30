"use client";
import { useState } from "react";
import Link from "next/link";
import type { Business, Comparable, Headcount, LenderLink, Loan, Location, Prospect, Transaction } from "@/lib/business";
import { money, moneyRange } from "@/lib/format";
import ContactCard from "./ContactCard";
import SaveButton from "./SaveButton";
import PipelineBox from "./PipelineBox";
import HeadcountChart from "./HeadcountChart";
import ValueChart, { valueHistory } from "./ValueChart";
import { CustomersSuppliers, WhatTheyDo } from "./Offering";
import PeopleAdvisors from "./PeopleAdvisors";
import PublicRecords, { type SourceRecord } from "./PublicRecords";
import { estimateValue } from "@/lib/valuation";
import { industryLabel, slug } from "@/lib/industries";
import Icon, { industryIcon } from "./Icon";
import MiniMap from "./MiniMap";

export type Profile = Business & { loans: Loan[]; comps?: Comparable[]; headcounts?: Headcount[]; sources?: SourceRecord[]; lenders?: LenderLink[]; locations?: Location[];
  prospects?: { market: string; items: Prospect[] }[]; transactions?: Transaction[] };

// "https://www.blastrac.com/" -> "blastrac.com"
function siteLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Website";
  }
}

// The company's LinkedIn page itself: DuckDuckGo's "!ducky" jumps straight to the top result of a
// search limited to LinkedIn company pages (used until the LinkedIn step has found the exact page).
function linkedInSearch(b: Profile) {
  const name = b.name.replace(/,?\s+(LLC|L\.L\.C\.|INC\.?|CORP\.?|CO\.?|PLLC|LTD\.?)$/i, "");
  return `https://duckduckgo.com/?q=${encodeURIComponent(`!ducky site:linkedin.com/company "${name}" ${b.city ?? ""} Oklahoma`)}`;
}

const pct = (v: unknown) => (v == null ? "—" : `${(Number(v) * 100).toFixed(0)}%`);
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
const initials = (name: string) => name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

// Year of the first PPP loan (headcounts were reported then): 2020 for most, 2021 for second-draw-only.
const pppYear = (loans: Loan[]) => {
  const d = loans.find((l) => l.date_approved)?.date_approved;
  return d ? new Date(d).getFullYear() : 2020;
};

type Tab = "overview" | "financials" | "people" | "records";

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
  const fleet = b.est_method === "fleet";                    // trucking company known from its FMCSA registration
  const approximate = b.geo_precision === "zip";             // placed at its ZIP: the address couldn't be mapped
  const src = Object.fromEntries((b.sources ?? []).map((s) => [s.source, s.data as Record<string, any>]));  // eslint-disable-line @typescript-eslint/no-explicit-any
  // The owner's own profile, only while it's for the owner we show (it was found for a name).
  const ownerLinkedIn = src.linkedin?.owner_url && src.linkedin.owner_name === b.owner_name ? src.linkedin.owner_url : null;
  const value = estimateValue({ ...b, public_company: !!src.sec || undefined, is_nonprofit: b.is_nonprofit || !!src.irs990 });
  // Earliest of the record-based year and the founding year the company's own site states.
  const founded = [src.founded?.year, src.fdic?.founded, src.fmcsa?.registered, src.website_profile?.founded_year]
    .filter((y): y is number => typeof y === "number").sort((a, b) => a - b)[0] ?? null;
  const ownershipChange = src.sba?.ownership_change_year ?? null;
  const latest = b.headcounts?.length ? b.headcounts[b.headcounts.length - 1] : null;
  // What today's figures rest on, and how recent it is.
  const reportedSrc = src.sec ? `SEC filings (FY${src.sec.year})` : src.fdic ? `FDIC call report (${src.fdic.year})`
    : src.ncua ? `NCUA call report (${src.ncua.quarter})` : src.irs990 ? `IRS Form 990${src.irs990.year ? ` (${src.irs990.year})` : ""}` : "reported figures";
  const basis = b.est_method === "verified" ? "verified financials"
    : reported ? reportedSrc
    : fromPlan && latest ? `${latest.employees.toLocaleString()} employees on its ${latest.year} 401(k) filing`
    : fromPlan ? "the employee count on its latest 401(k) filing"
    : fleet && src.fmcsa ? `${Math.round(src.fmcsa.drivers || 0).toLocaleString()} drivers and ${Math.round(src.fmcsa.power_units).toLocaleString()} trucks on its federal motor carrier registration`
    : fleet ? "the drivers and trucks on its federal motor carrier registration"
    : b.est_method === "employees" ? `${b.jobs_reported} employees reported for PPP in ${pppYear(b.loans)}, grown at the industry's Oklahoma rate since`
    : b.est_method === "blend" ? `its ${b.jobs_reported} employees and its payroll, both reported for PPP in ${pppYear(b.loans)} and brought up to date`
    : b.est_method === "payroll" ? `PPP payroll (${pppYear(b.loans)})`
    : b.est_method === "owner_earnings" ? `owner earnings on its PPP loan (${pppYear(b.loans)})`
    : "typical figures for its industry (2022 Economic Census), not its own records";
  // The margin actually applied (IRS industry margin adjusted for size) when the data has it.
  const irsMargin = b.est_ebitda_margin != null && b.est_method !== "owner_earnings";
  const margin = irsMargin ? b.est_ebitda_margin : b.ebitda_margin;
  const tabs: [Tab, string][] = [["overview", "Overview"], ["financials", "Financials"], ["people", "People"], ["records", "Records"]];

  async function share() {
    const url = `${window.location.origin}/business/${b.id}`;
    try {
      if (navigator.share) await navigator.share({ title: b.name, url });
      else { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    } catch { /* share sheet dismissed */ }
  }

  const employeesNow = fromPlan && latest ? latest.employees : fleet && src.fmcsa ? Math.max(src.fmcsa.drivers || 0, src.fmcsa.power_units || 0) : b.jobs_reported;
  const employeesNote = fromPlan && latest ? `on its ${latest.year} 401(k) filing` : fleet ? "drivers (FMCSA)"
    : b.jobs_reported ? `reported in ${pppYear(b.loans)}` : "not reported";
  const confidence = reported || b.est_method === "verified" ? "Reported figures"
    : b.est_confidence === "high" ? "High confidence" : b.est_confidence === "medium" ? "Medium confidence" : "Low confidence";
  // The estimate's position within its range, for the hero bar.
  const span = (lo: number, mid: number, hi: number) => (hi > lo ? Math.min(100, Math.max(0, ((mid - lo) / (hi - lo)) * 100)) : 50);
  const sellLabel = b.sell_score == null ? null : b.sell_score >= 60 ? "High sell likelihood" : b.sell_score >= 40 ? "Likely to sell"
    : b.sell_score >= 20 ? "Some signs of a sale" : "Unlikely to sell soon";
  const known: [boolean, string][] = [
    [!noLoan, noLoan ? "No PPP loan" : `PPP loan, ${pppYear(b.loans)}`],
    [!!latest, latest ? `401(k) filing, ${latest.year}` : "No 401(k) filing"],
    [reported || b.est_method === "verified", reported || b.est_method === "verified" ? "Reported financials" : "No reported financials"],
    [!!b.website, b.website ? "Company website" : "No website found"],
    [!!b.owner_name, b.owner_name ? "Owner named" : "Owner not found"],
    ...(b.locations?.length ? [[true, `${b.locations.length + 1} locations found`] as [boolean, string]] : []),
    ...(src.fmcsa ? [[true, "Trucking registration (FMCSA)"] as [boolean, string]] : []),
    ...(src.contracts ? [[true, "Federal contracts"] as [boolean, string]] : []),
  ];
  // "How we got $X": the estimate as a few lines of arithmetic anyone can follow.
  const mathRows: { label: string; value: string; kind?: string }[] = [];
  {
    const mid = Number(b.est_revenue_mid), emp = Number(b.est_revenue_by_employees), pay = Number(b.est_revenue_by_payroll);
    let base: number | null = null;
    if (reported || b.est_method === "verified") {
      mathRows.push({ label: b.est_method === "verified" ? "Verified revenue" : `Reported revenue, ${reportedSrc}`, value: money(mid), kind: "total" });
    } else {
      if ((b.est_method === "blend" || b.est_method === "employees") && b.jobs_reported && emp) {
        mathRows.push({ label: `${b.jobs_reported} employees × ${money(emp / b.jobs_reported)} each`, value: money(emp) });
        base = emp;
        if (b.est_method === "blend" && pay) {
          mathRows.push({ label: "PPP payroll ÷ payroll's usual share of revenue", value: money(pay) });
          base = Math.sqrt(emp * pay);
        }
      } else if (b.est_method === "payroll" && pay) {
        mathRows.push({ label: "PPP payroll ÷ payroll's usual share of revenue", value: money(pay) });
        base = pay;
      } else if (fromPlan && latest) {
        mathRows.push({ label: `${latest.employees.toLocaleString()} employees (${latest.year} 401(k) filing) × ${money(mid / latest.employees)} each`, value: money(mid) });
      } else if (fleet && employeesNow) {
        mathRows.push({ label: `${Number(employeesNow).toLocaleString()} drivers × ${money(mid / Number(employeesNow))} each`, value: money(mid) });
      } else if (avg) {
        mathRows.push({ label: `A typical ${(industryLabel(b.naics) ?? b.industry).toLowerCase()} business in Oklahoma`, value: money(mid) });
      } else if (b.est_method === "owner_earnings") {
        mathRows.push({ label: "Owner earnings on its PPP loan ÷ a 30% margin", value: money(mid) });
      }
      // Calibration and the range tilt, shown as one step so the arithmetic adds up.
      if (base && Math.abs(mid / base - 1) > 0.02) {
        const why = [
          b.est_calibration != null && Math.abs(Number(b.est_calibration) - 1) >= 0.01 ? "calibrated to real figures in its industry" : null,
          Number(b.est_tilt) > 0 ? "shown toward the top of its range" : null,
        ].filter(Boolean).join(", ") || "adjusted";
        mathRows.push({ label: `${why[0].toUpperCase()}${why.slice(1)}`, value: `×${(mid / base).toFixed(2)}` });
      }
      mathRows.push({ label: "Revenue", value: money(mid), kind: "total" });
    }
    if (b.est_ebitda_mid != null) {
      mathRows.push({ label: margin != null && !(src.sec && src.sec.ebitda) ? `× ${pct(margin)} profit margin` : "Profit (EBITDA)", value: money(b.est_ebitda_mid) });
    }
    if (value) mathRows.push({ label: `× ${value.multiple} sale multiple = value`, value: money(value.mid), kind: "value" });
  }
  const kicker = [industryLabel(b.naics) ?? b.industry, b.city ? `${b.city}, OK` : null].filter(Boolean).join(" · ");
  const subline = [
    [b.address, b.city].filter(Boolean).join(", ") || null,
    b.locations?.length ? `${b.locations.length + 1} locations` : null,
    src.website_profile?.family_owned ? `Family-owned${src.website_profile.generation ? `, ${ordinal(src.website_profile.generation)} generation` : ""}` : null,
    founded ? `Since ${founded}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className={compact ? "profile" : "profile full"}>
      <div className="bp-head">
        <div className="bp-kicker">
          {industryLabel(b.naics)
            ? <a href={`/oklahoma/${slug(industryLabel(b.naics)!)}${b.city ? `/${slug(b.city)}` : ""}`}>{kicker}</a>
            : kicker}
        </div>
        <h1>{b.name}</h1>
        <div className="bp-sub">
          {subline}
          {approximate && <span title="We couldn't map this address, so the pin is placed in its ZIP code"> · approximate map location</span>}
        </div>
        {(ownershipChange || src.sec || src.contracts || b.is_nonprofit) && (
          <div className="badges">
            {ownershipChange && <span className="badge warn">New owners FY{ownershipChange}</span>}
            {src.sec && <span className="badge info">Public company{src.sec.tickers?.length ? ` · ${src.sec.tickers.join(", ")}` : ""}</span>}
            {src.contracts && <span className="badge info">Federal contractor</span>}
            {b.is_nonprofit && <span className="badge">Nonprofit</span>}
          </div>
        )}
      </div>

      {b.est_method === "branch" ? (
        <div className="branch-note">
          <Icon name="map" size={18} />
          <div>
            <b>A location of {b.parent_name}</b>
            <div className="sub">Revenue, profit and value are for the whole company, on its page.</div>
          </div>
          {b.parent_id && (onSelect
            ? <a className="btn primary" href={`/business/${b.parent_id}`} onClick={(e) => { e.preventDefault(); onSelect(Number(b.parent_id)); }}>View company</a>
            : <Link className="btn primary" href={`/business/${b.parent_id}`}>View company</Link>)}
        </div>
      ) : (
        <>
          {/* One headline number: value where a sale value applies, else revenue. */}
          <div className="bp-hero">
            <div className="bp-hero-top">
              <span>{value ? "Estimated value" : reported ? "Reported revenue" : "Estimated revenue"}</span>
              <span className={`bp-conf ${b.est_confidence === "low" && !reported ? "low" : ""}`}>{confidence}</span>
            </div>
            <div className="bp-hero-v">{money(value ? value.mid : b.est_revenue_mid)}</div>
            {(() => {
              const lo = Number(value ? value.low : b.est_revenue_low), mid = Number(value ? value.mid : b.est_revenue_mid),
                hi = Number(value ? value.high : b.est_revenue_high);
              return hi > lo ? (
                <div className="bp-range">
                  <div className="bp-bar"><span style={{ left: `${span(lo, mid, hi)}%` }} /></div>
                  <div className="bp-range-l"><span>{money(lo)}</span><span>likely range</span><span>{money(hi)}</span></div>
                </div>
              ) : null;
            })()}
            {value && <div className="bp-hero-note">About {value.multiple}× its yearly profit, typical for a company this size in its industry.</div>}
          </div>

          <div className="bp-facts">
            <div><div className="k">Revenue</div><div className="v">{money(b.est_revenue_mid)}</div><div className="r">a year</div></div>
            <div><div className="k">Profit (EBITDA)</div><div className="v">{money(b.est_ebitda_mid)}</div>
              <div className="r">{margin != null ? `${pct(margin)} of revenue` : "before interest & taxes"}</div></div>
            <div><div className="k">Employees</div><div className="v">{employeesNow ? Number(employeesNow).toLocaleString() : "—"}</div><div className="r">{employeesNote}</div></div>
          </div>
        </>
      )}

      {/* Who to talk to: the owner and the ways to reach or keep track of the business. */}
      <div className="bp-owner">
        <div className="bp-owner-top">
          <div className="bp-owner-av" aria-hidden>{b.owner_name ? initials(b.owner_name) : <Icon name="user" size={18} />}</div>
          <div className="bp-owner-who">
            <div className="name">{b.owner_name ?? "Owner not found yet"}</div>
            <div className="src">
              {b.owner_name ? (b.owner_title || "Owner") : "We haven't found the owner in public records"}
              {b.owner_source && <> · <a href={b.owner_source} target="_blank" rel="nofollow noopener noreferrer">source</a></>}
              {ownerLinkedIn && <> · <a href={ownerLinkedIn} target="_blank" rel="nofollow noopener noreferrer">LinkedIn</a></>}
            </div>
          </div>
          {sellLabel && <span className={`bp-sell ${Number(b.sell_score) >= 40 ? "hot" : ""}`}>{sellLabel}</span>}
        </div>
        <div className="bp-owner-actions">
          {b.website && <a className="btn" href={b.website} target="_blank" rel="nofollow noopener noreferrer"><Icon name="globe" size={15} />{siteLabel(b.website)}</a>}
          <a className="btn" href={src.linkedin?.company_url || linkedInSearch(b)} target="_blank" rel="nofollow noopener noreferrer"><Icon name="linkedin" size={15} />LinkedIn</a>
          <SaveButton id={String(b.id)} name={b.name} city={b.city} />
          <button className="btn" onClick={share}><Icon name="share" size={15} />{copied ? "Link copied" : "Share"}</button>
        </div>
      </div>
      <ContactCard id={String(b.id)} name={b.name} owner={b.owner_name} />
      <PipelineBox id={String(b.id)} />

      <div className="tabs" role="tablist">
        {tabs.map(([key, label]) => (
          <button key={key} role="tab" className="tab" aria-selected={tab === key} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      {tab === "overview" && (
        <>
          {b.est_method !== "branch" && (
            <div className="section">
              <h2>How we got {money(value ? value.mid : b.est_revenue_mid)}</h2>
              <p className="disclaimer">Based on {basis}.</p>
              <div className="bp-math">
                {mathRows.map((r, i) => (
                  <div key={i} className={r.kind ?? ""}><span>{r.label}</span><b>{r.value}</b></div>
                ))}
              </div>
              <p className="disclaimer" style={{ marginTop: 8 }}>
                <button className="link-btn" onClick={() => setTab("financials")}>Full calculation</button>{" · "}
                <Link href={`/correct?business=${b.id}`}>Own this business? Correct these figures</Link>
              </p>
            </div>
          )}
          <div className="section">
            <h2>What we know</h2>
            <div className="bp-known">
              {known.map(([ok, label]) => (
                <div key={label} className={ok ? "" : "no"}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth="2.5" aria-hidden="true"
                    stroke={ok ? "#15803d" : "#8a97a8"}>{ok ? <path d="M5 12l5 5L20 7" /> : <path d="M6 6l12 12M18 6L6 18" />}</svg>
                  {label}
                </div>
              ))}
            </div>
          </div>
          {b.sell_score != null && b.sell_signals?.length ? (
            <div className="section">
              <h2>Signs of a sale <span className={`badge ${b.sell_score >= 40 ? "warn" : ""}`}>{sellLabel}</span></h2>
              <ul className="bp-list">{b.sell_signals.map((s) => <li key={s}>{s}</li>)}</ul>
              <p className="disclaimer">From public records and the company&apos;s website, not a statement that it&apos;s for sale.</p>
            </div>
          ) : null}
          <WhatTheyDo offering={src.website_offering} industry={industryLabel(b.naics) ?? b.industry} />
          {b.transactions?.length ? (
            <div className="section">
              <h2><Icon name="briefcase" size={16} />Ownership &amp; transactions</h2>
              <ul className="deal-list">
                {b.transactions.map((t) => (
                  <li key={t.buyer}>
                    <b>{t.deal_type === "acquisition" || t.deal_type === "merger" ? `Acquired by ${t.buyer}` : `${t.deal_type[0].toUpperCase()}${t.deal_type.slice(1)} from ${t.buyer}`}</b>
                    {t.deal_date && <span className="muted"> · {new Date(t.deal_date + "T00:00:00").toLocaleDateString(undefined, { year: "numeric", month: "short" })}</span>}
                    {t.summary && <div className="muted">{t.summary}</div>}
                    {t.source_url && <a href={t.source_url} target="_blank" rel="nofollow noopener noreferrer">Source</a>}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {b.comps === undefined && (
            <div className="section loading-more"><span className="spinner" aria-hidden /> Loading customers, comparables and locations…</div>
          )}
          <CustomersSuppliers offering={src.website_offering} contracts={src.contracts} onSelect={onSelect} prospects={b.prospects ?? []} />
        </>
      )}

      {tab === "people" && (
        <>
          <PeopleAdvisors sources={b.sources ?? []} owner={b.owner_name}
            lenders={[...b.loans.map((l) => l.lender), ...((src.sba?.loans ?? []) as { lender: string }[]).map((l) => l.lender)]} />
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
          ) : b.comps === undefined ? <div className="section loading-more"><span className="spinner" aria-hidden /> Loading banks…</div> : null}
        </>
      )}

      {tab === "records" && (
        <>
          {b.loans.length ? (
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
          ) : null}
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
              <p className="disclaimer">Revenue, profit and value are for the whole company.</p>
            </div>
          ) : null}
          <PublicRecords sources={b.sources ?? []} />
          {!compact && b.lat != null && <div className="minimap"><MiniMap lat={Number(b.lat)} lon={Number(b.lon)} /></div>}
        </>
      )}

      {tab === "financials" && (
        <>
        {(() => {
          // Value over time: needs a headcount basis for today's estimate (PPP grown since, or the latest 401(k) count).
          const ppp = b.jobs_reported && !noLoan ? { year: pppYear(b.loans), employees: b.jobs_reported } : null;
          const plan = b.headcounts ?? [];
          const basisNow = b.est_method === "retirement_plan" && plan.length ? plan[plan.length - 1].employees
            : (b.est_method === "employees" || b.est_method === "blend") && b.jobs_reported ? b.jobs_reported * (Number(b.est_growth) || 1) : null;
          const points = valueHistory({ valueNow: value?.mid ?? null, employeesNow: basisNow, ppp, plan });
          return points ? <ValueChart points={points} /> : null;
        })()}
        <HeadcountChart
          ppp={b.jobs_reported && !noLoan ? { year: pppYear(b.loans), employees: b.jobs_reported } : null}
          plan={b.headcounts ?? []} revenuePerEmployee={b.revenue_per_employee} ebitdaMargin={margin} />
        {b.comps?.length ? (
          <div className="section">
            <h2>Compared with similar businesses nearby</h2>
            <table>
              <thead><tr><th>Business</th><th className="num">Est. revenue</th><th className="num hide-sm">Est. profit</th><th className="num">Distance</th></tr></thead>
              <tbody>
                <tr className="bp-me"><td><b>{b.name}</b><div className="disclaimer" style={{ margin: 0 }}>this business</div></td>
                  <td className="num">{money(b.est_revenue_mid)}</td><td className="num hide-sm">{money(b.est_ebitda_mid)}</td><td className="num">—</td></tr>
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
        ) : null}
        <div className="section">
          <h2>The full calculation</h2>
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
          {b.est_method === "blend" && (
            <table><tbody>
              <tr><td>Employees reported to the SBA</td><td className="num">{b.jobs_reported}</td></tr>
              <tr><td>Revenue from headcount (employees × revenue per employee for companies this size)</td><td className="num">{money(b.est_revenue_by_employees)}</td></tr>
              <tr><td>Revenue from PPP payroll (payroll ÷ payroll&apos;s share of revenue for companies this size)</td><td className="num">{money(b.est_revenue_by_payroll)}</td></tr>
              <tr><td>Estimate: the two combined (geometric mean)</td><td className="num">{money(b.est_revenue_mid)}</td></tr>
              <tr><td>EBITDA margin{irsMargin ? " (industry, adjusted for size)" : " (industry)"}</td><td className="num">{pct(margin)}</td></tr>
              <tr><td>EBITDA = revenue × margin</td><td className="num">{money(b.est_ebitda_mid)}</td></tr>
            </tbody></table>
          )}
          {b.est_calibration != null && Math.abs(Number(b.est_calibration) - 1) >= 0.01 && (
            <p className="disclaimer">Calibrated: revenue {Number(b.est_calibration) < 1 ? "lowered" : "raised"} to{" "}
              {Math.round(Number(b.est_calibration) * 100)}% of the industry-average estimate, to match what businesses in this industry
              actually report.</p>
          )}
          {Number(b.est_tilt) > 0 && (
            <p className="disclaimer">Figures are shown toward the upper part of their range rather than at its middle.</p>
          )}
          {b.est_growth_rate != null ? (
            <p className="disclaimer">Brought up to date assuming revenue has grown {(Number(b.est_growth_rate) * 100).toFixed(0)}% a year
              since 2020, when the PPP figures were reported; included above.</p>
          ) : (Number(b.est_inflation) > 1.001 || Math.abs(Number(b.est_growth || 1) - 1) > 0.001) && (
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
            <p>These are the business&apos;s actual figures, provided to SeeBITDA, not an estimate.</p>
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
          {b.est_confidence === "low" && (b.est_method === "employees" || b.est_method === "blend") && (
            <p className="disclaimer">Low confidence: the employee-based and payroll-based estimates differ by more than 2×.</p>
          )}
          {irsMargin && (
            <p className="disclaimer">EBITDA margin: from IRS tax returns of S corporations in this industry (2019–2022),
              adjusted for company size: smaller companies typically run higher margins. EBITDA here is after
              owners&apos; salaries.</p>
          )}
          <p className="disclaimer">Benchmarks: {b.benchmark_source ?? "sector default"}.
            {!fromPlan && !avg && !fleet && " PPP loans were sized on 2019–2020 payroll, so figures reflect that period."} These are
            statistical estimates, not reported financials.
            {noLoan && (b.key_source === "DOT" ? " Listing details come from the FMCSA motor carrier census."
              : b.key_source === "EIN" ? " Listing details come from the company's Form 5500 retirement-plan filing."
              : " Listing details come from Overture Maps open data.")}{" "}
            <Link href="/methodology">Full methodology</Link></p>
        </div>
        </>
      )}

    </div>
  );
}
