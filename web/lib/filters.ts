// Shared by the filter bar, its panels and the list header: sort options, and the active filters as
// short removable chips ("Revenue $1M+ ×").
import { money } from "./format";
import { INDUSTRIES } from "./industries";

export type FilterState = { sector: string; city: string; minRev: string; maxRev: string; sort: string; naics: string; lender: string; more: string };

export const SORTS: [string, string][] = [
  ["value_desc", "Value: high to low"], ["revenue_desc", "Revenue: high to low"], ["revenue_asc", "Revenue: low to high"],
  ["ebitda_desc", "EBITDA: high to low"], ["jobs_desc", "Most employees"], ["sell_desc", "Likely to sell"], ["name", "Name A–Z"],
];

export const SELL_LABELS: Record<string, string> = { "20": "Some signs of a sale", "40": "Likely to sell", "60": "High chance of a sale" };

const $ = (v: string) => money(v).replace(".0M", "M").replace(".0B", "B");
const range = (lo: string, hi: string, fmt: (v: string) => string, what: string) =>
  lo && hi ? `${what} ${fmt(lo)}–${fmt(hi)}` : lo ? `${what} ${fmt(lo)}+` : `${what} up to ${fmt(hi)}`;

/** The everyday name for a NAICS selection: "Plumbing, heating & air", "NAICS 238220", "3 NAICS codes". */
export function industryName(naics: string) {
  if (!naics) return "";
  const codes = naics.split(",");
  const known = INDUSTRIES.find((i) => i.naics.join(",") === naics);
  return known ? known.label : codes.length === 1 ? `NAICS ${codes[0]}` : `${codes.length} NAICS codes`;
}

export type Chip = { key: string; label: string; clear: Partial<FilterState> };

/** Every filter that's set, as a chip that knows how to clear itself. */
export function activeChips(f: FilterState, lenderName: (key: string) => string): Chip[] {
  const more = new URLSearchParams(f.more);
  const without = (...keys: string[]) => { const n = new URLSearchParams(more); keys.forEach((k) => n.delete(k)); return { more: n.toString() }; };
  const g = (k: string) => more.get(k) ?? "";
  const chips: Chip[] = [];
  if (f.sector) chips.push({ key: "sector", label: f.sector, clear: { sector: "" } });
  if (f.naics) chips.push({ key: "naics", label: industryName(f.naics), clear: { naics: "" } });
  if (f.city) chips.push({ key: "city", label: f.city, clear: { city: "" } });
  if (f.minRev || f.maxRev) chips.push({ key: "rev", label: range(f.minRev, f.maxRev, $, "Revenue"), clear: { minRev: "", maxRev: "" } });
  if (g("min_value") || g("max_value")) chips.push({ key: "value", label: range(g("min_value"), g("max_value"), $, "Value"), clear: without("min_value", "max_value") });
  if (g("min_ebitda") || g("max_ebitda")) chips.push({ key: "ebitda", label: range(g("min_ebitda"), g("max_ebitda"), $, "EBITDA"), clear: without("min_ebitda", "max_ebitda") });
  if (g("min_emp") || g("max_emp")) chips.push({ key: "emp", label: `${range(g("min_emp"), g("max_emp"), (v) => v, "").trim()} employees`, clear: without("min_emp", "max_emp") });
  if (g("sell")) chips.push({ key: "sell", label: SELL_LABELS[g("sell")] ?? "Likely to sell", clear: without("sell") });
  if (g("years")) chips.push({ key: "years", label: `${g("years")}+ years in business`, clear: without("years") });
  if (f.lender) {
    const keys = f.lender.split(",");
    chips.push({ key: "lender", label: keys.length === 1 ? `Lender: ${lenderName(keys[0])}` : `${keys.length} lenders`, clear: { lender: "" } });
  }
  const flags: [string, string][] = [["owner", "Owner known"], ["phone", "Has phone"], ["email", "Has email"], ["website", "Has website"],
    ["contractor", "Federal contractor"], ["public", "Incl. public companies"], ["x_branch", "No extra locations"],
    ["x_nonprofit", "No nonprofits"], ["x_franchise", "No franchises"]];
  for (const [k, label] of flags) if (g(k)) chips.push({ key: k, label, clear: without(k) });
  if (g("basis")) chips.push({ key: "basis", label: `Based on: ${g("basis").split(",").length} source${g("basis").includes(",") ? "s" : ""}`, clear: without("basis") });
  return chips;
}
