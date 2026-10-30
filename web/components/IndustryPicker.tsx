"use client";
import { useState } from "react";
import { INDUSTRIES } from "@/lib/industries";
import { SECTORS } from "@/lib/sectors";
import { blurOnEnter, isTouch } from "@/lib/touch";

// Choosing an industry by its everyday name ("Plumbing, heating & air") or broad sector. Exact NAICS
// codes have their own picker (NaicsPicker).
const SHORT = 10;   // in the phone sheet, industries shown before "Show all"

export default function IndustryPicker({ sector, naics, onChange, short = false }: {
  sector: string; naics: string; short?: boolean;
  onChange: (next: { sector: string; naics: string }, done: boolean) => void;   // done: a single choice, the panel can close
}) {
  const [query, setQuery] = useState("");
  const [all, setAll] = useState(!short);
  const q = query.trim().toLowerCase();
  const common = INDUSTRIES.filter((i) => !q || i.label.toLowerCase().includes(q) || i.terms.some((t) => t.includes(q)));
  const sectors = SECTORS.filter((s) => !q || s.label.toLowerCase().includes(q));
  const any = !sector && !naics;

  return (
    <div className="industry-picker">
      <input className="filter-input" placeholder="Search industries" value={query} autoFocus={!isTouch()}
        enterKeyHint="done" onKeyDown={blurOnEnter} onChange={(e) => setQuery(e.target.value)} />
      {!q && (
        <button type="button" className={`option ${any ? "selected" : ""}`} onClick={() => onChange({ sector: "", naics: "" }, true)}>All industries</button>
      )}
      {common.length > 0 && <>
        <h4>Common industries</h4>
        <div className="ind-grid">
          {(all || q ? common : common.slice(0, SHORT)).map((i) => {
            const on = naics === i.naics.join(",");
            return (
              <button type="button" key={i.label} className={`option ${on ? "selected" : ""}`}
                onClick={() => onChange(on ? { sector: "", naics: "" } : { sector: "", naics: i.naics.join(",") }, true)}>{i.label}</button>
            );
          })}
        </div>
        {!all && !q && common.length > SHORT && (
          <button type="button" className="link-btn show-all" onClick={() => setAll(true)}>Show all {common.length} industries</button>
        )}
      </>}
      {(all || q) && sectors.length > 0 && <>
        <h4>Broad sectors</h4>
        <div className="ind-grid">
          {sectors.map((s) => (
            <button type="button" key={s.label} className={`option ${sector === s.label ? "selected" : ""}`}
              onClick={() => onChange(sector === s.label ? { sector: "", naics: "" } : { sector: s.label, naics: "" }, true)}>{s.label}</button>
          ))}
        </div>
      </>}
    </div>
  );
}
