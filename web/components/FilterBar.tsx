"use client";
import { useEffect, useRef, useState } from "react";
import { activeChips, industryName, type FilterState } from "@/lib/filters";
import { moreCount } from "@/lib/more-filters";
import FilterPanel from "./FilterPanel";
import Icon from "./Icon";
import IndustryPicker from "./IndustryPicker";

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
  const [open, setOpen] = useState<"" | "industry" | "size" | "more" | "all">("");
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
  SIZE_KEYS.forEach((k) => moreOnly.delete(k));
  const moreN = moreCount(moreOnly.toString()) + (value.lender ? 1 : 0) + (value.city ? 1 : 0);
  const chips = activeChips(value, (k) => lenderNames[k] ?? titleCase(k));
  const industryLabel = value.sector || industryName(value.naics) || "Industry";
  const selling = !!more.get("sell");
  const setSell = () => {
    const n = new URLSearchParams(value.more);
    if (selling) n.delete("sell"); else n.set("sell", "40");
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
          <button className={`pill ${value.sector || value.naics ? "active" : ""}`} aria-expanded={open === "industry"} onClick={() => toggle("industry")}>
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
          <button className={`pill ${sizeN ? "active" : ""}`} aria-expanded={open === "size"} onClick={() => toggle("size")}>
            Size{sizeN ? <span className="pill-n">{sizeN}</span> : null}<Icon name="chevron" size={14} className="chev" />
          </button>
          {open === "size" && panel(["size"])}
        </div>

        <button className={`pill sell-pill ${selling ? "on" : ""}`} aria-pressed={selling} onClick={setSell}>
          <Icon name="flame" size={15} />Likely to sell
        </button>

        <div className="pill-wrap hide-phone">
          <button className={`pill ${moreN ? "active" : ""}`} aria-expanded={open === "more"} onClick={() => toggle("more")}>
            More{moreN ? <span className="pill-n">{moreN}</span> : null}<Icon name="chevron" size={14} className="chev" />
          </button>
          {open === "more" && panel(["more"])}
        </div>
      </div>

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
  );
}
