"use client";
import { useEffect, useRef, useState } from "react";
import { SECTORS } from "@/lib/sectors";
import Icon from "./Icon";
import NaicsPicker from "./NaicsPicker";
import MoreFilters from "./MoreFilters";
import { moreCount } from "@/lib/more-filters";
import { blurOnEnter, isTouch } from "@/lib/touch";

export type FilterState = { sector: string; city: string; minRev: string; maxRev: string; sort: string; naics: string; lender: string; more: string };

const SORTS: [string, string][] = [
  ["value_desc", "Value: high to low"], ["revenue_desc", "Revenue: high to low"], ["revenue_asc", "Revenue: low to high"],
  ["ebitda_desc", "EBITDA: high to low"], ["jobs_desc", "Most employees"], ["sell_desc", "Likely to sell"], ["name", "Name A–Z"],
];

// Pill buttons that open small panels, Zillow-style, instead of a row of dropdowns.
export default function FilterBar({ value, onChange, cities }: {
  value: FilterState;
  onChange: (next: Partial<FilterState>) => void;
  cities: { city: string; count: number }[];
}) {
  const [open, setOpen] = useState<"" | "industry" | "city" | "naics" | "more">("");
  const [cityQuery, setCityQuery] = useState("");
  const naicsSel = value.naics ? value.naics.split(",") : [];
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
  // Revenue and lender live in the More panel too, so they count toward its badge.
  const moreN = moreCount(value.more) + (value.minRev || value.maxRev ? 1 : 0) + (value.lender ? 1 : 0);
  const naicsLabel = !naicsSel.length ? "NAICS" : naicsSel.length === 1 ? `NAICS ${naicsSel[0]}` : `NAICS (${naicsSel.length})`;
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
            <input className="filter-input" placeholder="Find a city" value={cityQuery} autoFocus={!isTouch()} enterKeyHint="done" onKeyDown={blurOnEnter} onChange={(e) => setCityQuery(e.target.value)} />
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
        <button className={`pill ${moreN ? "active" : ""}`} aria-expanded={open === "more"} onClick={() => toggle("more")}>
          {moreN ? `More (${moreN})` : "More"}<Icon name="chevron" size={14} className="chev" />
        </button>
        {open === "more" && <MoreFilters value={value.more} revenue={{ minRev: value.minRev, maxRev: value.maxRev }} lender={value.lender}
          onApply={(next) => onChange(next)} onClose={() => setOpen("")} />}
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
