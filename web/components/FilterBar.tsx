"use client";
import { useEffect, useRef, useState } from "react";
import { SECTORS } from "@/lib/sectors";
import { money } from "@/lib/format";
import Icon from "./Icon";
import NaicsPicker from "./NaicsPicker";
import RevenueRange from "./RevenueRange";
import MoreFilters from "./MoreFilters";
import { moreCount } from "@/lib/more-filters";

export type FilterState = { sector: string; city: string; minRev: string; maxRev: string; sort: string; naics: string; lender: string; more: string };

const SORTS: [string, string][] = [
  ["value_desc", "Value: high to low"], ["revenue_desc", "Revenue: high to low"], ["revenue_asc", "Revenue: low to high"],
  ["ebitda_desc", "EBITDA: high to low"], ["jobs_desc", "Most employees"], ["sell_desc", "Likely to sell"], ["name", "Name A–Z"],
];

function revenueLabel(min: string, max: string) {
  if (min && max) return `${money(min)}–${money(max)}`;
  if (min) return `${money(min)}+`;
  if (max) return `Up to ${money(max)}`;
  return "Revenue";
}

// Pill buttons that open small panels, Zillow-style, instead of a row of dropdowns.
export default function FilterBar({ value, onChange, cities }: {
  value: FilterState;
  onChange: (next: Partial<FilterState>) => void;
  cities: { city: string; count: number }[];
}) {
  const [open, setOpen] = useState<"" | "industry" | "city" | "revenue" | "naics" | "lender" | "more">("");
  const [cityQuery, setCityQuery] = useState("");
  const [lenderQuery, setLenderQuery] = useState("");
  const [lenderOptions, setLenderOptions] = useState<{ key: string; name: string; count: number }[] | null>(null);
  const naicsSel = value.naics ? value.naics.split(",") : [];
  const lenderSel = value.lender ? value.lender.split(",") : [];
  useEffect(() => {
    if ((open === "lender" || lenderSel.length) && !lenderOptions) fetch("/api/lenders").then((r) => r.json()).then(setLenderOptions).catch(() => setLenderOptions([]));
  }, [open, lenderSel.length, lenderOptions]);
  const flip = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]).join(",");
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!bar.current?.contains(e.target as Node)) setOpen(""); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(""); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, []);

  const toggle = (k: typeof open) => setOpen(open === k ? "" : k);
  const anyFilter = value.sector || value.city || value.minRev || value.maxRev || value.naics || value.lender || value.more;
  const moreN = moreCount(value.more);
  const naicsLabel = !naicsSel.length ? "NAICS" : naicsSel.length === 1 ? `NAICS ${naicsSel[0]}` : `NAICS (${naicsSel.length})`;
  const shownLenders = (lenderOptions ?? []).filter((l) => l.name.toLowerCase().includes(lenderQuery.toLowerCase())).slice(0, 200);
  const lenderLabel = !lenderSel.length ? "Lender"
    : lenderSel.length === 1 ? (lenderOptions?.find((l) => l.key === lenderSel[0])?.name ?? "1 lender") : `Lenders (${lenderSel.length})`;
  const shownCities = cities.filter((c) => c.city.toLowerCase().includes(cityQuery.toLowerCase())).slice(0, 80);

  return (
    <div className="pills" ref={bar}>
      {/* Phones: panels open as a bottom sheet over a dimmed page (see globals.css); tapping outside closes. */}
      {open && <div className="sheet-backdrop" onClick={() => setOpen("")} aria-hidden />}
      <div className="pill-wrap">
        <button className={`pill ${value.sector ? "active" : ""}`} aria-expanded={open === "industry"} onClick={() => toggle("industry")}>
          {value.sector || "Industry"}<Icon name="chevron" size={14} className="chev" />
        </button>
        {open === "industry" && (
          <div className="popover">
            <h4>Industry</h4>
            <button className={`option ${!value.sector ? "selected" : ""}`} onClick={() => { onChange({ sector: "" }); setOpen(""); }}>All industries</button>
            {SECTORS.map((s) => (
              <button key={s.label} className={`option ${value.sector === s.label ? "selected" : ""}`}
                onClick={() => { onChange({ sector: s.label }); setOpen(""); }}>{s.label}</button>
            ))}
          </div>
        )}
      </div>

      <div className="pill-wrap">
        <button className={`pill ${value.city ? "active" : ""}`} aria-expanded={open === "city"} onClick={() => toggle("city")}>
          {value.city || "City"}<Icon name="chevron" size={14} className="chev" />
        </button>
        {open === "city" && (
          <div className="popover">
            <input className="filter-input" placeholder="Find a city" value={cityQuery} autoFocus onChange={(e) => setCityQuery(e.target.value)} />
            <button className={`option ${!value.city ? "selected" : ""}`} onClick={() => { onChange({ city: "" }); setOpen(""); }}>All cities</button>
            {shownCities.map((c) => (
              <button key={c.city} className={`option ${value.city === c.city ? "selected" : ""}`}
                onClick={() => { onChange({ city: c.city }); setOpen(""); }}>
                {c.city}<span className="count">{c.count.toLocaleString()}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="pill-wrap">
        <button className={`pill ${naicsSel.length ? "active" : ""}`} aria-expanded={open === "naics"} onClick={() => toggle("naics")}>
          {naicsLabel}<Icon name="chevron" size={14} className="chev" />
        </button>
        {open === "naics" && (
          <div className="popover wide naics-pop">
            <NaicsPicker selected={naicsSel} onChange={(codes) => onChange({ naics: codes.join(",") })} />
            <div className="popover-actions">
              <button className="link-btn" onClick={() => onChange({ naics: "" })}>Clear{naicsSel.length ? ` (${naicsSel.length})` : ""}</button>
              <button className="link-btn" onClick={() => setOpen("")}>Done</button>
            </div>
          </div>
        )}
      </div>

      <div className="pill-wrap">
        <button className={`pill ${lenderSel.length ? "active" : ""}`} aria-expanded={open === "lender"} onClick={() => toggle("lender")}>
          {lenderLabel}<Icon name="chevron" size={14} className="chev" />
        </button>
        {open === "lender" && (
          <div className="popover wide">
            <h4>Businesses that borrowed from (PPP and SBA loans)</h4>
            <input className="filter-input" placeholder="Find a bank" value={lenderQuery} autoFocus onChange={(e) => setLenderQuery(e.target.value)} />
            <div className="check-list">
              {!lenderOptions && <div className="check-option">Loading…</div>}
              {shownLenders.map((l) => (
                <label key={l.key} className="check-option">
                  <input type="checkbox" checked={lenderSel.includes(l.key)} onChange={() => onChange({ lender: flip(lenderSel, l.key) })} />
                  <span className="label">{l.name}</span><span className="count">{l.count.toLocaleString()}</span>
                </label>
              ))}
            </div>
            <div className="popover-actions">
              <button className="link-btn" onClick={() => onChange({ lender: "" })}>Clear{lenderSel.length ? ` (${lenderSel.length})` : ""}</button>
              <button className="link-btn" onClick={() => setOpen("")}>Done</button>
            </div>
          </div>
        )}
      </div>

      <div className="pill-wrap">
        <button className={`pill ${value.minRev || value.maxRev ? "active" : ""}`} aria-expanded={open === "revenue"} onClick={() => toggle("revenue")}>
          {revenueLabel(value.minRev, value.maxRev)}<Icon name="chevron" size={14} className="chev" />
        </button>
        {open === "revenue" && (
          <div className="popover wide">
            <h4>Revenue range</h4>
            <RevenueRange minRev={value.minRev} maxRev={value.maxRev} onChange={(next) => onChange(next)} />
            <div className="popover-actions">
              <button className="link-btn" onClick={() => onChange({ minRev: "", maxRev: "" })}>Reset</button>
              <button className="link-btn" onClick={() => setOpen("")}>Done</button>
            </div>
          </div>
        )}
      </div>

      <div className="pill-wrap">
        <button className={`pill ${moreN ? "active" : ""}`} aria-expanded={open === "more"} onClick={() => toggle("more")}>
          {moreN ? `More (${moreN})` : "More"}<Icon name="chevron" size={14} className="chev" />
        </button>
        {open === "more" && <MoreFilters value={value.more} onApply={(more) => onChange({ more })} onClose={() => setOpen("")} />}
      </div>

      <select className="sort-select" aria-label="Sort" value={value.sort} onChange={(e) => onChange({ sort: e.target.value })}>
        {SORTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>

      {anyFilter && (
        <button className="clear-filters" onClick={() => onChange({ sector: "", city: "", minRev: "", maxRev: "", naics: "", lender: "", more: "" })}>Clear filters</button>
      )}
    </div>
  );
}
