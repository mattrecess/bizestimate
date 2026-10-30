"use client";
import { useState } from "react";
import { money } from "@/lib/format";

const VALUE = [250e3, 500e3, 1e6, 2e6, 3e6, 5e6, 10e6, 25e6, 50e6];
const EBITDA = [100e3, 250e3, 500e3, 1e6, 2e6, 3e6, 5e6, 10e6];
const EMPLOYEES: [string, string, string][] = [["", "", "Any"], ["1", "9", "1–9"], ["10", "19", "10–19"], ["20", "49", "20–49"],
  ["50", "99", "50–99"], ["100", "249", "100–249"], ["250", "", "250+"]];
const SELL: [string, string][] = [["", "Any"], ["20", "Some signs"], ["40", "Elevated"], ["60", "High"]];
const YEARS = ["", "10", "20", "30", "40"];
const BASIS: [string, string][] = [["reported", "Reported or verified"], ["k401", "401(k) headcount"], ["ppp", "PPP data"], ["avg", "Industry average"]];

// The "More" panel: edits a copy of the filters and applies them together.
export default function MoreFilters({ value, onApply, onClose }: { value: string; onApply: (more: string) => void; onClose: () => void }) {
  const [p, setP] = useState(() => new URLSearchParams(value));
  const get = (k: string) => p.get(k) ?? "";
  const set = (changes: Record<string, string>) => setP((old) => {
    const n = new URLSearchParams(old);
    for (const [k, v] of Object.entries(changes)) if (v) n.set(k, v); else n.delete(k);
    return n;
  });
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
        <button key={v || "any"} className={`chip ${get(k) === v ? "selected" : ""}`} onClick={() => set({ [k]: v })}>{label}</button>
      ))}
    </div>
  );
  const basis = get("basis") ? get("basis").split(",") : [];
  const emp = `${get("min_emp")}|${get("max_emp")}`;

  return (
    <div className="popover wide more-pop">
      <div className="more-body">
        <h4>Estimated value</h4>{range("min_value", "max_value", VALUE)}
        <h4>EBITDA</h4>{range("min_ebitda", "max_ebitda", EBITDA)}
        <h4>Employees</h4>
        <div className="chips">
          {EMPLOYEES.map(([lo, hi, label]) => (
            <button key={label} className={`chip ${emp === `${lo}|${hi}` ? "selected" : ""}`} onClick={() => set({ min_emp: lo, max_emp: hi })}>{label}</button>
          ))}
        </div>
        <h4>Likely to sell</h4>{chips("sell", SELL)}
        <h4>Years in business</h4>{chips("years", YEARS.map((y) => [y, y ? `${y}+` : "Any"]))}
        <h4>Owner &amp; contact</h4>
        <div className="checks">{flag("owner", "Owner known")}{flag("phone", "Has phone")}{flag("email", "Has email")}{flag("website", "Has website")}</div>
        <h4>Public records</h4>
        <div className="checks">{flag("contractor", "Federal contractor")}</div>
        <h4>Estimate based on</h4>
        <div className="checks">
          {BASIS.map(([k, label]) => (
            <label key={k} className="check"><input type="checkbox" checked={basis.includes(k)}
              onChange={() => set({ basis: (basis.includes(k) ? basis.filter((b) => b !== k) : [...basis, k]).join(",") })} />{label}</label>
          ))}
        </div>
        <h4>Include</h4>
        <div className="checks">{flag("public", "Public companies (SEC filers)")}</div>
        <h4>Exclude</h4>
        <div className="checks">{flag("x_branch", "Extra locations on the map")}{flag("x_nonprofit", "Nonprofits")}{flag("x_franchise", "Franchises (from SBA loan records)")}</div>
      </div>
      <div className="popover-actions">
        <button className="link-btn" onClick={() => setP(new URLSearchParams())}>Reset all</button>
        <button className="btn primary" onClick={() => { onApply(p.toString()); onClose(); }}>Apply</button>
      </div>
    </div>
  );
}
