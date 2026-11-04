"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Business, Comparable, Headcount, LenderLink, Loan, Location, Prospect, Transaction } from "@/lib/business";
import { money, moneyRange } from "@/lib/format";
import ContactCard from "./ContactCard";
import RadarButton from "./RadarButton";
import PipelineBox from "./PipelineBox";
import HeadcountChart from "./HeadcountChart";
import ValueChart, { valueHistory } from "./ValueChart";
import { CustomersSuppliers, WhatTheyDo } from "./Offering";
import PeopleAdvisors from "./PeopleAdvisors";
import PublicRecords, { type SourceRecord } from "./PublicRecords";
import { estimateValue } from "@/lib/valuation";
import { displayName } from "@/lib/seo";
import { leadership } from "@/lib/leadership";
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


// Shared by the full business page and the explorer's side panel (compact: no mini-map).
export default function BusinessProfile({ b, compact = false, onSelect, onWebsite }: {
  b: Profile;
  compact?: boolean;
  onSelect?: (id: number) => void;
  onWebsite?: (url: string) => void;   // shows the website beside the profile (wide screens), where it allows that
}) {
  const [copied, setCopied] = useState(false);
  // Whether the company's website can be shown in the preview: checked when the profile opens, so the
  // click is instant; sites that forbid it (or phones) open in a new tab as before.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    setPreviewUrl(null);
    if (!onWebsite || !b.website || !window.matchMedia("(min-width: 1100px)").matches) return;
    const ctrl = new AbortController();
    fetch(`/api/website-preview/${b.id}`, { signal: ctrl.signal }).then((r) => r.json())
      .then((d) => { if (d.ok) setPreviewUrl(d.url); }).catch(() => {});
    return () => ctrl.abort();
  }, [b.id, b.website, onWebsite]);
  const avg = b.est_method === "industry_average";           // no business-specific data at all
  const noLoan = !b.loans.length;
  const fromPlan = b.est_method === "retirement_plan";       // re-based on the newest Form 5500 count
  const reported = b.est_method === "reported";              // SEC, FDIC or Form 990 figures
  const fleet = b.est_method === "fleet";                    // trucking company known from its FMCSA registration
  const approximate = b.geo_precision === "zip";             // placed at its ZIP: the address couldn't be mapped
  const src = Object.fromEntries((b.sources ?? []).map((s) => [s.source, s.data as Record<string, any>]));  // eslint-disable-line @typescript-eslint/no-explicit-any
  // The owner's own profile, only while it's for the owner we show (it was found for a name).
  const ownerLinkedIn = src.linkedin?.owner_url && src.linkedin.owner_name === b.owner_name ? src.linkedin.owner_url : null;
  const lead = leadership(b, b.sources ?? [], ownerLinkedIn);
  const ownerEntry = lead.people.find((p) => p.owner);
  const team = lead.people.filter((p) => !p.owner);
  const [showTeam, setShowTeam] = useState(false);
  const value = estimateValue({ ...b, public_company: !!src.sec || undefined, is_nonprofit: b.is_nonprofit || !!src.irs990 });
  // Earliest of the record-based year and the founding year the company's own site states.
  const founded = [src.founded?.year, src.fdic?.founded, src.fmcsa?.registered, src.website_profile?.founded_year]
    .filter((y): y is number => typeof y === "number").sort((a, b) => a - b)[0] ?? null;
  const ownershipChange = src.sba?.ownership_change_year ?? null;
  const latest = b.headcounts?.length ? b.headcounts[b.headcounts.length - 1] : null;
  // What today's figures rest on, and how recent it is.
  const reportedSrc = src.sec ? `SEC filings (FY${src.sec.year})` : src.fdic ? `FDIC call report (${src.fdic.year})`
    : src.ncua ? `NCUA call report (${src.ncua.quarter})` : src.irs990 ? `IRS Form 990${src.irs990.year ? ` (${src.irs990.year})` : ""}` : "reported figures";
  // The margin actually applied (IRS industry margin adjusted for size) when the data has it.
  const irsMargin = b.est_ebitda_margin != null && b.est_method !== "owner_earnings";
  const margin = irsMargin ? b.est_ebitda_margin : b.ebitda_margin;

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
  // "How we got $X": Revenue, EBITDA and Estimated value, each with a line or two of gray arithmetic beneath.
  const steps: { title: string; value: string; notes: string[]; kind?: string }[] = [];
  {
    const mid = Number(b.est_revenue_mid), emp = Number(b.est_revenue_by_employees), pay = Number(b.est_revenue_by_payroll);
    // The simple estimate (employees grown since they were counted x revenue per employee), when the load stored its inputs.
    const counted = Number(b.est_employees), rpe = Number(b.est_rpe), year = Number(b.est_count_year);
    const simple = !reported && b.est_method !== "verified" && counted > 0 && rpe > 0
      && ["employees", "retirement_plan", "fleet"].includes(String(b.est_method));
    const notes: string[] = [];
    if (reported || b.est_method === "verified") {
      notes.push(b.est_method === "verified" ? "Verified figures" : `Reported, ${reportedSrc}`);
    } else if (simple) {
      const growth = Number(b.est_growth) || 1, rate = Number(b.est_growth_rate) || 0.08;
      const today = Math.round(counted * growth);
      const unit = b.est_method === "fleet" ? "drivers/trucks" : "employees";
      const source = b.est_method === "fleet" ? "on its FMCSA registration"
        : b.est_method === "retirement_plan" ? `on its ${year} 401(k) filing` : `on its ${year} PPP loan`;
      notes.push(`${today.toLocaleString()} ${unit} × ${money(rpe)} revenue per employee`);
      notes.push(growth > 1.001
        ? `${counted.toLocaleString()} ${source}, grown ${Math.round(rate * 100)}% a year`
        : `${counted.toLocaleString()} ${source}`);
    } else if (b.jobs_reported && emp && (b.est_method === "blend" || b.est_method === "employees")) {
      notes.push(`${b.jobs_reported} employees × ${money(emp / b.jobs_reported)} each`);
    } else if (b.est_method === "payroll" && pay) {
      notes.push("PPP payroll ÷ payroll's usual share of revenue");
    } else if (fromPlan && latest) {
      notes.push(`${latest.employees.toLocaleString()} employees (${latest.year} 401(k) filing) × ${money(mid / latest.employees)} each`);
    } else if (fleet && employeesNow) {
      notes.push(`${Number(employeesNow).toLocaleString()} drivers × ${money(mid / Number(employeesNow))} each`);
    } else if (avg) {
      notes.push(`A typical ${(industryLabel(b.naics) ?? b.industry).toLowerCase()} business in Oklahoma`);
    } else if (b.est_method === "owner_earnings") {
      notes.push("Owner earnings on its PPP loan ÷ a 30% margin");
    }
    steps.push({ title: "Revenue", value: money(mid), notes });
    if (b.est_ebitda_mid != null) {
      steps.push({ title: "EBITDA", value: money(b.est_ebitda_mid),
        notes: margin != null && !(src.sec && src.sec.ebitda) ? [`${pct(margin)} EBITDA margin`] : src.sec?.ebitda ? ["Reported"] : [] });
    }
    if (value) steps.push({ title: "Estimated value", value: money(value.mid), notes: [`${value.multiple}× EBITDA multiple`], kind: "value" });
  }
  const industryText = industryLabel(b.naics) ?? b.industry;
  // Quick facts under the name, each with its icon.
  const meta: [string, string, string?, string?][] = [
    ["pin", [b.address, b.city].filter(Boolean).join(", ") + (b.city ? ", OK" : ""),
      approximate ? "We couldn't map this address, so the map pin is placed in its ZIP code" : undefined],
    ...(b.locations?.length ? [["map", `${b.locations.length + 1} locations`] as [string, string]] : []),
    // A chain or kiosk brand shown once (etl/places_only.py): how many Oklahoma locations it has.
    ...(b.chain_locations ? [["map", `${b.chain_locations.toLocaleString()} Oklahoma locations`] as [string, string]] : []),
    ...(founded ? [["calendar", `Since ${founded}`] as [string, string]] : []),
    ...(src.website_profile?.family_owned ? [["user", `Family-owned${src.website_profile.generation ? `, ${ordinal(src.website_profile.generation)} generation` : ""}`] as [string, string]] : []),
    // The industry code, linking to every business with it (as the NAICS filter does).
    ...(b.naics ? [["briefcase", b.naics_recorded ? `NAICS ${b.naics} (filed as ${b.naics_recorded})` : `NAICS ${b.naics}`,
      `${b.industry ? `${b.industry} (NAICS ${b.naics})` : `NAICS ${b.naics}`}${b.naics_recorded ? `. Corrected from ${b.naics_recorded}, the code it filed (e.g. on its PPP loan), which didn't match what it does.` : ""}`,
      `/?q=${b.naics}`] as [string, string, string, string]] : []),
  ];

  return (
    <div className={compact ? "profile" : "profile full"}>
      <div className="bp-head">
        <div className="bp-top-actions">
          <RadarButton id={String(b.id)} name={b.name} city={b.city} />
          <button className="btn" onClick={share}><Icon name="share" size={15} />{copied ? "Link copied" : "Share"}</button>
        </div>
        <div className="bp-title">
          <div className="ind-icon" aria-hidden><Icon name={industryIcon(b.naics)} size={22} /></div>
          <div className="bp-title-text">
            <h1>{displayName(b.name)}</h1>
            {industryText && <div className="bp-industry">
              {industryLabel(b.naics)
                ? <a href={`/oklahoma/${slug(industryLabel(b.naics)!)}${b.city ? `/${slug(b.city)}` : ""}`}>{industryText}</a>
                : industryText}
            </div>}
          </div>
        </div>
        <ul className="bp-meta">
          {meta.filter(([, text]) => text).map(([icon, text, title, href]) => href ? (
            <li key={text} title={title}><a href={href}><Icon name={icon} size={14} />{text}</a></li>
          ) : (
            <li key={text} title={title}><Icon name={icon} size={14} />{text}{title ? " (approx.)" : ""}</li>
          ))}
        </ul>
        {/* Where to read more about the company: its own website and its LinkedIn page. */}
        <div className="bp-links">
          {b.website && (
            <a className="bp-link" href={b.website} target="_blank" rel="nofollow noopener noreferrer"
              onClick={(e) => { if (previewUrl && onWebsite && !e.metaKey && !e.ctrlKey) { e.preventDefault(); onWebsite(previewUrl); } }}>
              <span className="bp-link-ic"><Icon name="globe" size={16} /></span>
              <span className="bp-link-t"><b>Company website</b><span>{previewUrl ? `Preview ${siteLabel(b.website)} beside this` : siteLabel(b.website)}</span></span>
              <Icon name={previewUrl ? "back" : "external"} size={14} className={previewUrl ? "bp-link-out flip" : "bp-link-out"} />
            </a>
          )}
          <a className="bp-link" href={src.linkedin?.company_url || linkedInSearch(b)} target="_blank" rel="nofollow noopener noreferrer">
            <span className="bp-link-ic li"><Icon name="linkedin" size={16} /></span>
            <span className="bp-link-t"><b>{src.linkedin?.company_url ? "LinkedIn page" : "Find on LinkedIn"}</b>
              <span>{src.linkedin?.company_url ? "Company profile and employees" : "Search LinkedIn for this company"}</span></span>
            <Icon name="external" size={14} className="bp-link-out" />
          </a>
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
            <div className="sub">Revenue, EBITDA and value are for the whole company, on its page.</div>
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
            {value && <div className="bp-hero-note">About {value.multiple}× its yearly EBITDA, typical for a company this size in its industry.</div>}
          </div>

          <div className="bp-facts">
            <div><div className="k">Revenue</div><div className="v">{money(b.est_revenue_mid)}</div><div className="r">a year</div></div>
            <div><div className="k">EBITDA</div><div className="v">{money(b.est_ebitda_mid)}</div>
              <div className="r">{margin != null ? `${pct(margin)} of revenue` : "before interest & taxes"}</div></div>
            <div><div className="k">Employees</div><div className="v">{employeesNow ? Number(employeesNow).toLocaleString() : "—"}</div><div className="r">{employeesNote}</div></div>
          </div>
        </>
      )}

      {/* Who runs it: the owner, the rest of the leadership team, and the ways to reach the business. */}
      <div className="bp-owner">
        <div className="bp-owner-h">Leadership</div>
        <div className="bp-owner-top">
          <div className="bp-owner-av" aria-hidden>{b.owner_name ? initials(b.owner_name) : <Icon name="user" size={18} />}</div>
          <div className="bp-owner-who">
            <div className="name">{b.owner_name ?? "Owner not found yet"}</div>
            <div className="src">
              {b.owner_name ? (b.owner_title || "Owner") : "We haven't found the owner in public records"}
              {b.owner_source && <> · <a href={b.owner_source} target="_blank" rel="nofollow noopener noreferrer">source</a></>}
              {ownerEntry && ownerEntry.sources.length > 1 && <> · confirmed by {ownerEntry.sources.length} sources</>}
              {ownerLinkedIn && <> · <a href={ownerLinkedIn} target="_blank" rel="nofollow noopener noreferrer">LinkedIn</a></>}
            </div>
          </div>
          {sellLabel && <span className={`bp-sell ${Number(b.sell_score) >= 40 ? "hot" : ""}`}>{sellLabel}</span>}
        </div>
        {/* How to reach them, right under the owner: published contacts, then the owner's own (signed in). */}
        <ContactCard id={String(b.id)} name={b.name} owner={b.owner_name} embedded />
        {/* The rest of the leadership team, most senior first (lib/leadership.ts). */}
        {team.length > 0 && (
          <ul className="bp-team">
            {(showTeam ? team : team.slice(0, 5)).map((p) => (
              <li key={p.name}>
                <div className="bp-team-av" aria-hidden>{initials(p.name)}</div>
                <div className="bp-team-who">
                  <div className="name">{p.name}</div>
                  <div className="src">{p.title}
                    {p.linkedin && <> · <a href={p.linkedin} target="_blank" rel="nofollow noopener noreferrer">LinkedIn</a></>}
                    {" · "}{p.url ? <a href={p.url} target="_blank" rel="nofollow noopener noreferrer">{p.sources.join(", ")}</a> : p.sources.join(", ")}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {team.length > 5 && (
          <button type="button" className="link-btn bp-team-more" onClick={() => setShowTeam((v) => !v)}>
            {showTeam ? "Show fewer" : `Show all ${team.length + 1} people`}</button>
        )}
        {lead.depth === "team" && (
          <div className="bp-depth team">
            <b>Has a management team.</b> Someone besides the owner runs part of the business, which buyers pay more for.
          </div>
        )}
      </div>
      <PipelineBox id={String(b.id)} />

      {/* Everything on one scrolling page: the estimate, then financials, people, and public records. */}
          {b.est_method !== "branch" && (
            <div className="section">
              <h2>How we got {money(value ? value.mid : b.est_revenue_mid)}</h2>
              <div className="bp-math">
                {steps.map((st) => (
                  <div key={st.title} className={st.kind ?? ""}>
                    <div className="bp-math-row"><span>{st.title}</span><b>{st.value}</b></div>
                    {st.notes.map((n) => <div key={n} className="bp-math-note">{n}</div>)}
                  </div>
                ))}
              </div>
              <p className="disclaimer" style={{ marginTop: 8 }}>
                <Link href={`/correct?business=${b.id}`}>Own this business? Correct these figures</Link>
              </p>
            </div>
          )}
          {/* How the value and headcount have moved, right after how the estimate was worked out. */}
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
            <div className="section loading-more"><span className="spinner" aria-hidden /> Loading customers, comparables, banks and locations…</div>
          )}
          <CustomersSuppliers offering={src.website_offering} contracts={src.contracts} onSelect={onSelect} prospects={b.prospects ?? []} />

      {/* Financials */}
        {b.comps?.length ? (
          <div className="section">
            <h2>Compared with similar businesses nearby</h2>
            <table>
              <thead><tr><th>Business</th><th className="num">Est. revenue</th><th className="num hide-sm">Est. EBITDA</th><th className="num">Distance</th></tr></thead>
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
        <div className="section" id="calculation">
          <h2>Ranges &amp; sources</h2>
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
          {value && <table><tbody><tr><td>Value range</td><td className="num">{moneyRange(value.low, value.high)}</td></tr></tbody></table>}
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

      {/* People */}
          <PeopleAdvisors sources={b.sources ?? []}
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
          ) : null}

      {/* Records */}
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
              <p className="disclaimer">Revenue, EBITDA and value are for the whole company.</p>
            </div>
          ) : null}
          <PublicRecords sources={b.sources ?? []} />
          {!compact && b.lat != null && <div className="minimap"><MiniMap lat={Number(b.lat)} lon={Number(b.lon)} /></div>}

    </div>
  );
}
