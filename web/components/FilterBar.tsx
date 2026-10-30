"use client";
import { useEffect, useRef, useState } from "react";
import { activeChips, industryName, type FilterState } from "@/lib/filters";
import { moreCount } from "@/lib/more-filters";
import FilterPanel from "./FilterPanel";
import Icon from "./Icon";
import IndustryPicker from "./IndustryPicker";
import NaicsPicker from "./NaicsPicker";
import { INDUSTRIES } from "@/lib/industries";

export type { FilterState };

const SIZE_KEYS = ["min_value", "max_value", "min_ebitda", "max_ebitda", "min_emp", "max_emp"];
const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

// The filters: Industry, Size, a one-tap "Likely to sell", and More, with whatever is set shown
// underneath as chips to remove. Phones get one "Filters" button that opens every section in a sheet.
export default function FilterBar({ value, onChange, cities }: {
  value: FilterState;
  onChange: (next: Partial<FilterState>) => void;
  cities: { city: string; count: number }[];
}) {
  const [open, setOpen] = useState<"" | "industry" | "naics" | "size" | "more" | "all">("");
  const [lenderNames, setLenderNames] = useState<Record<string, string>>({});
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!bar.current?.contains(e.target as Node)) setOpen(""); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(""); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, []);
  useEffect(() => {
    if (!value.lender || Object.keys(lenderNames).length) return;
    fetch("/api/lenders").then((r) => r.json())
      .then((l: { key: string; name: string }[]) => setLenderNames(Object.fromEntries(l.map((x) => [x.key, x.name])))).catch(() => {});
  }, [value.lender, lenderNames]);

  const toggle = (k: typeof open) => setOpen(open === k ? "" : k);
  const more = new URLSearchParams(value.more);
  const sizeN = (value.minRev || value.maxRev ? 1 : 0) + [["min_value", "max_value"], ["min_ebitda", "max_ebitda"], ["min_emp", "max_emp"]]
    .filter(([a, b]) => more.get(a) || more.get(b)).length;
  const moreOnly = new URLSearchParams(value.more);
  [...SIZE_KEYS, "sell", "owner"].forEach((k) => moreOnly.delete(k));   // those have their own buttons
  const moreN = moreCount(moreOnly.toString()) + (value.lender ? 1 : 0) + (value.city ? 1 : 0);
  // Likely to sell, Owner known and the industry show on their own buttons, so they don't repeat as chips.
  const chips = activeChips(value, (k) => lenderNames[k] ?? titleCase(k)).filter((c) => c.key !== "sell" || more.get("sell") !== "40").filter((c) => c.key !== "owner")
    .filter((c) => !["sector", "naics"].includes(c.key));   // the Industry and NAICS buttons already name them
  // An everyday industry ("Roofing") shows on Industry; any other code selection shows on NAICS.
  const common = INDUSTRIES.some((i) => i.naics.join(",") === value.naics);
  const industryLabel = value.sector || (common ? industryName(value.naics) : "") || "Industry";
  const naicsSel = value.naics ? value.naics.split(",") : [];
  const naicsLabel = !naicsSel.length || common ? "NAICS" : naicsSel.length === 1 ? `NAICS ${naicsSel[0]}` : `NAICS (${naicsSel.length})`;
  const selling = !!more.get("sell");
  const ownerKnown = more.get("owner") === "1";
  const flip = (k: string, on: string) => {
    const n = new URLSearchParams(value.more);
    if (n.get(k)) n.delete(k); else n.set(k, on);
    onChange({ more: n.toString() });
  };
  const clearAll = () => onChange({ sector: "", city: "", minRev: "", maxRev: "", naics: "", lender: "", more: "" });
  const panel = (sections: ("industry" | "size" | "more")[]) =>
    <FilterPanel state={value} sections={sections} cities={cities} onApply={onChange} onClose={() => setOpen("")} />;

  return (
    <div className="filters" ref={bar}>
      <div className="pills">
        {/* Phones: panels open as a bottom sheet over a dimmed page (see globals.css); tapping outside closes. */}
        {open && <div className="sheet-backdrop" onClick={() => setOpen("")} aria-hidden />}

        <div className="pill-wrap show-phone">
          <button className={`pill ${chips.length ? "active" : ""}`} aria-expanded={open === "all"} onClick={() => toggle("all")}>
            <Icon name="sliders" size={15} />Filters{chips.length ? <span className="pill-n">{chips.length}</span> : null}
          </button>
          {open === "all" && panel(["industry", "size", "more"])}
        </div>

        <div className="pill-wrap hide-phone">
          <button className={`pill ${value.sector || common ? "active" : ""}`} aria-expanded={open === "industry"} onClick={() => toggle("industry")}>
            <span className="pill-text">{industryLabel}</span><Icon name="chevron" size={14} className="chev" />
          </button>
          {open === "industry" && (
            <div className="popover wide industry-pop">
              <IndustryPicker sector={value.sector} naics={value.naics} onChange={(n, done) => { onChange(n); if (done) setOpen(""); }} />
              <div className="popover-actions">
                <button type="button" className="link-btn" onClick={() => onChange({ sector: "", naics: "" })}>Clear</button>
                <button type="button" className="btn primary" onClick={() => setOpen("")}>Done</button>
              </div>
            </div>
          )}
        </div>

        <div className="pill-wrap hide-phone">
          <button className={`pill ${naicsSel.length && !common ? "active" : ""}`} aria-expanded={open === "naics"} onClick={() => toggle("naics")}>
            {naicsLabel}<Icon name="chevron" size={14} className="chev" />
          </button>
          {open === "naics" && (
            <div className="popover wide naics-pop">
              <NaicsPicker selected={common ? [] : naicsSel} onChange={(codes) => onChange({ sector: "", naics: codes.join(",") })} />
              <div className="popover-actions">
                <button type="button" className="link-btn" onClick={() => onChange({ naics: "" })}>Clear</button>
                <button type="button" className="btn primary" onClick={() => setOpen("")}>Done</button>
              </div>
            </div>
          )}
        </div>

        <div className="pill-wrap hide-phone">
          <button className={`pill ${sizeN ? "active" : ""}`} aria-expanded={open === "size"} onClick={() => toggle("size")}>
            Size{sizeN ? <span className="pill-n">{sizeN}</span> : null}<Icon name="chevron" size={14} className="chev" />
          </button>
          {open === "size" && panel(["size"])}
        </div>

        <button className={`pill sell-pill ${selling ? "on" : ""}`} aria-pressed={selling} onClick={() => flip("sell", "40")}>
          <Icon name="flame" size={15} />Likely to sell
        </button>
        <button className={`pill toggle-pill ${ownerKnown ? "on" : ""}`} aria-pressed={ownerKnown} onClick={() => flip("owner", "1")}>
          <Icon name="user" size={15} />Owner known
        </button>

        <div className="pill-wrap hide-phone">
          <button className={`pill ${moreN ? "active" : ""}`} aria-expanded={open === "more"} onClick={() => toggle("more")}>
            More{moreN ? <span className="pill-n">{moreN}</span> : null}<Icon name="chevron" size={14} className="chev" />
          </button>
          {open === "more" && panel(["more"])}
        </div>

        {/* What's set, continuing the row to the right of More. */}
        {chips.length > 0 && (
          <div className="active-chips" aria-label="Filters in use">
            {chips.map((c) => (
              <button type="button" key={c.key} className="active-chip" onClick={() => onChange(c.clear)} aria-label={`Remove filter: ${c.label}`}>
                {c.label}<Icon name="x" size={13} />
              </button>
            ))}
            {chips.length > 1 && <button type="button" className="link-btn clear-all" onClick={clearAll}>Clear all</button>}
          </div>
        )}
      </div>
    </div>
  );
}
