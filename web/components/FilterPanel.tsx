"use client";
import { useEffect, useState } from "react";
import { money } from "@/lib/format";
import { SELL_LABELS, type FilterState } from "@/lib/filters";
import { blurOnEnter } from "@/lib/touch";
import Icon from "./Icon";
import IndustryPicker from "./IndustryPicker";
import RevenueRange from "./RevenueRange";

const VALUE = [250e3, 500e3, 1e6, 2e6, 3e6, 5e6, 10e6, 25e6, 50e6];
const EBITDA = [100e3, 250e3, 500e3, 1e6, 2e6, 3e6, 5e6, 10e6];
const EMPLOYEES: [string, string, string][] = [["", "", "Any"], ["1", "9", "1–9"], ["10", "19", "10–19"], ["20", "49", "20–49"],
  ["50", "99", "50–99"], ["100", "249", "100–249"], ["250", "", "250+"]];
const SELL: [string, string][] = [["", "Any"], ...Object.entries(SELL_LABELS)];
const YEARS = ["", "10", "20", "30", "40"];
const BASIS: [string, string][] = [["reported", "Reported or verified"], ["k401", "401(k) headcount"], ["ppp", "PPP data"], ["avg", "Industry average"]];
// Filters with their own URL keys; everything else travels together as FilterState.more.
const OWN: [keyof FilterState, string][] = [["sector", "sector"], ["naics", "naics"], ["city", "city"], ["minRev", "min_rev"], ["maxRev", "max_rev"], ["lender", "lender"]];

export type Section = "industry" | "size" | "more";

// A panel of filters edited as a draft and applied together: "Size" and "More" on wide screens, and
// every section in one sheet on phones.
export default function FilterPanel({ state, sections, cities, onApply, onClose }: {
  state: FilterState; sections: Section[]; cities: { city: string; count: number }[];
  onApply: (next: Partial<FilterState>) => void; onClose: () => void;
}) {
  const [p, setP] = useState(() => {
    const n = new URLSearchParams(state.more);
    for (const [k, url] of OWN) if (state[k]) n.set(url, state[k]);
    return n;
  });
  const [lenderQuery, setLenderQuery] = useState("");
  const [lenders, setLenders] = useState<{ key: string; name: string; count: number }[] | null>(null);
  const showMore = sections.includes("more");
  useEffect(() => { if (showMore) fetch("/api/lenders").then((r) => r.json()).then(setLenders).catch(() => setLenders([])); }, [showMore]);

  const get = (k: string) => p.get(k) ?? "";
  const set = (changes: Record<string, string>) => setP((old) => {
    const n = new URLSearchParams(old);
    for (const [k, v] of Object.entries(changes)) if (v) n.set(k, v); else n.delete(k);
    return n;
  });
  // Clears only what this panel shows, so "Reset" in Size doesn't wipe the industry.
  const SECTION_KEYS: Record<Section, string[]> = {
    industry: ["sector", "naics"],
    size: ["min_rev", "max_rev", "min_value", "max_value", "min_ebitda", "max_ebitda", "min_emp", "max_emp"],
    more: ["sell", "years", "owner", "phone", "email", "website", "contractor", "lender", "city", "basis", "public", "x_branch", "x_nonprofit", "x_franchise"],
  };
  const reset = () => set(Object.fromEntries(sections.flatMap((s) => SECTION_KEYS[s]).map((k) => [k, ""])));
  const apply = () => {
    const more = new URLSearchParams(p);
    const next: Partial<FilterState> = {};
    for (const [k, url] of OWN) { next[k] = more.get(url) ?? ""; more.delete(url); }
    onApply({ ...next, more: more.toString() });
    onClose();
  };

  const flag = (k: string, label: string) => (
    <label className="check"><input type="checkbox" checked={get(k) === "1"} onChange={(e) => set({ [k]: e.target.checked ? "1" : "" })} />{label}</label>
  );
  const range = (minKey: string, maxKey: string, stops: number[]) => (
    <div className="range-boxes">
      <label>Minimum
        <select value={get(minKey)} onChange={(e) => set({ [minKey]: e.target.value })}>
          <option value="">No min</option>{stops.map((v) => <option key={v} value={v}>{money(v)}</option>)}
        </select>
      </label>
      <span className="dash">–</span>
      <label>Maximum
        <select value={get(maxKey)} onChange={(e) => set({ [maxKey]: e.target.value })}>
          <option value="">No max</option>{stops.map((v) => <option key={v} value={v}>{money(v)}</option>)}
        </select>
      </label>
    </div>
  );
  const chips = (k: string, options: [string, string][]) => (
    <div className="chips">
      {options.map(([v, label]) => (
        <button type="button" key={v || "any"} className={`chip ${get(k) === v ? "selected" : ""}`} onClick={() => set({ [k]: v })}>{label}</button>
      ))}
    </div>
  );
  const basis = get("basis") ? get("basis").split(",") : [];
  const lenderSel = get("lender") ? get("lender").split(",") : [];
  const flipLender = (k: string) => set({ lender: (lenderSel.includes(k) ? lenderSel.filter((x) => x !== k) : [...lenderSel, k]).join(",") });
  // Ticked banks first, so they stay in view while searching for others.
  const shownLenders = (lenders ?? []).filter((l) => lenderSel.includes(l.key) || l.name.toLowerCase().includes(lenderQuery.toLowerCase()))
    .sort((a, b) => Number(lenderSel.includes(b.key)) - Number(lenderSel.includes(a.key))).slice(0, 200);
  const emp = `${get("min_emp")}|${get("max_emp")}`;
  const all = sections.length > 1;

  return (
    <div className={`popover wide filter-panel ${all ? "all" : sections[0]}`}>
      {all && (
        <div className="panel-head">
          <h2>Filters</h2>
          <button type="button" className="signin-close" aria-label="Close" onClick={onClose}><Icon name="x" size={20} /></button>
        </div>
      )}
      <div className="panel-body">
        {sections.includes("industry") && (
          <section>
            <h3>Industry</h3>
            <IndustryPicker short sector={get("sector")} naics={get("naics")} onChange={(n) => set(n)} />
          </section>
        )}
        {sections.includes("size") && (
          <section>
            {all && <h3>Size</h3>}
            <h4>Revenue</h4>
            <RevenueRange minRev={get("min_rev")} maxRev={get("max_rev")} onChange={(r) => set({ min_rev: r.minRev, max_rev: r.maxRev })} />
            <h4>Estimated value</h4>{range("min_value", "max_value", VALUE)}
            <h4>EBITDA</h4>{range("min_ebitda", "max_ebitda", EBITDA)}
            <h4>Employees</h4>
            <div className="chips">
              {EMPLOYEES.map(([lo, hi, label]) => (
                <button type="button" key={label} className={`chip ${emp === `${lo}|${hi}` ? "selected" : ""}`} onClick={() => set({ min_emp: lo, max_emp: hi })}>{label}</button>
              ))}
            </div>
          </section>
        )}
        {showMore && (
          <section>
            {all && <h3>More</h3>}
            <h4>Likely to sell</h4>{chips("sell", SELL)}
            <h4>Years in business</h4>{chips("years", YEARS.map((y) => [y, y ? `${y}+` : "Any"]))}
            <h4>Owner &amp; contact</h4>
            <div className="checks">{flag("owner", "Owner known")}{flag("phone", "Has phone")}{flag("email", "Has email")}{flag("website", "Has website")}</div>
            <h4>City</h4>
            <select className="panel-select" value={get("city")} onChange={(e) => set({ city: e.target.value })} aria-label="City">
              <option value="">Any city</option>
              {get("city") && !cities.some((c) => c.city === get("city")) && <option value={get("city")}>{get("city")}</option>}
              {cities.map((c) => <option key={c.city} value={c.city}>{c.city} ({c.count.toLocaleString()})</option>)}
            </select>
            <h4>Lender (PPP and SBA loans){lenderSel.length ? ` · ${lenderSel.length} selected` : ""}</h4>
            <input className="filter-input" placeholder="Find a bank" value={lenderQuery} enterKeyHint="done" onKeyDown={blurOnEnter}
              onChange={(e) => setLenderQuery(e.target.value)} />
            <div className="check-list lender-list">
              {!lenders && <div className="check-option">Loading…</div>}
              {shownLenders.map((l) => (
                <label key={l.key} className="check-option">
                  <input type="checkbox" checked={lenderSel.includes(l.key)} onChange={() => flipLender(l.key)} />
                  <span className="label">{l.name}</span><span className="count">{l.count.toLocaleString()}</span>
                </label>
              ))}
            </div>
            <h4>Public records</h4>
            <div className="checks">{flag("contractor", "Federal contractor")}{flag("public", "Include public companies")}</div>
            <h4>Estimate based on</h4>
            <div className="checks">
              {BASIS.map(([k, label]) => (
                <label key={k} className="check"><input type="checkbox" checked={basis.includes(k)}
                  onChange={() => set({ basis: (basis.includes(k) ? basis.filter((b) => b !== k) : [...basis, k]).join(",") })} />{label}</label>
              ))}
            </div>
            <h4>Leave out</h4>
            <div className="checks">{flag("x_branch", "Extra locations on the map")}{flag("x_nonprofit", "Nonprofits")}{flag("x_franchise", "Franchises (from SBA loans)")}</div>
          </section>
        )}
      </div>
      <div className="popover-actions">
        <button type="button" className="link-btn" onClick={reset}>{all ? "Clear all" : "Reset"}</button>
        <button type="button" className="btn primary" onClick={apply}>{all ? "Show results" : "Apply"}</button>
      </div>
    </div>
  );
}
