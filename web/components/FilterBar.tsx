"use client";
import { useEffect, useRef, useState } from "react";
import { SECTORS } from "@/lib/sectors";
import { money } from "@/lib/format";
import Icon from "./Icon";

export type FilterState = { sector: string; city: string; minRev: string; maxRev: string; sort: string };

const MIN_REV = [250e3, 500e3, 1e6, 2e6, 5e6, 10e6, 25e6];
const MAX_REV = [500e3, 1e6, 2e6, 5e6, 10e6, 25e6, 50e6];
const SORTS: [string, string][] = [
  ["revenue_desc", "Revenue: high to low"], ["revenue_asc", "Revenue: low to high"],
  ["ebitda_desc", "EBITDA: high to low"], ["jobs_desc", "Most employees"], ["name", "Name A–Z"],
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
  const [open, setOpen] = useState<"" | "industry" | "city" | "revenue">("");
  const [cityQuery, setCityQuery] = useState("");
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!bar.current?.contains(e.target as Node)) setOpen(""); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(""); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, []);

  const toggle = (k: typeof open) => setOpen(open === k ? "" : k);
  const anyFilter = value.sector || value.city || value.minRev || value.maxRev;
  const shownCities = cities.filter((c) => c.city.toLowerCase().includes(cityQuery.toLowerCase())).slice(0, 80);

  return (
    <div className="pills" ref={bar}>
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
        <button className={`pill ${value.minRev || value.maxRev ? "active" : ""}`} aria-expanded={open === "revenue"} onClick={() => toggle("revenue")}>
          {revenueLabel(value.minRev, value.maxRev)}<Icon name="chevron" size={14} className="chev" />
        </button>
        {open === "revenue" && (
          <div className="popover">
            <h4>Minimum revenue</h4>
            <div className="chips">
              {MIN_REV.map((v) => (
                <button key={v} className={`chip ${value.minRev === String(v) ? "selected" : ""}`}
                  onClick={() => onChange({ minRev: value.minRev === String(v) ? "" : String(v) })}>{money(v)}+</button>
              ))}
            </div>
            <h4>Maximum revenue</h4>
            <div className="chips">
              {MAX_REV.map((v) => (
                <button key={v} className={`chip ${value.maxRev === String(v) ? "selected" : ""}`}
                  onClick={() => onChange({ maxRev: value.maxRev === String(v) ? "" : String(v) })}>{money(v)}</button>
              ))}
            </div>
            <div className="popover-actions">
              <button className="link-btn" onClick={() => onChange({ minRev: "", maxRev: "" })}>Reset</button>
              <button className="link-btn" onClick={() => setOpen("")}>Done</button>
            </div>
          </div>
        )}
      </div>

      <select className="sort-select" aria-label="Sort" value={value.sort} onChange={(e) => onChange({ sort: e.target.value })}>
        {SORTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>

      {anyFilter && (
        <button className="clear-filters" onClick={() => onChange({ sector: "", city: "", minRev: "", maxRev: "" })}>Clear filters</button>
      )}
    </div>
  );
}
