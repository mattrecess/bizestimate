import { money } from "./format";
import { industryLabel } from "./industries";
import { estimateValue } from "./valuation";
import type { Profile } from "@/components/BusinessProfile";

// "COOK FEED AND OUTDOOR YUKON LLC" -> "Cook Feed and Outdoor Yukon LLC"; mixed-case names are left as written.
const KEEP_UPPER = new Set(["LLC", "LLP", "LP", "PLLC", "PC", "PA", "USA", "OK", "OKC", "II", "III", "IV", "DBA", "MD", "DDS", "CPA"]);
const SMALL = new Set(["and", "of", "the", "for", "in", "at", "on", "a", "an", "to", "by"]);
export function displayName(name: string) {
  if (name !== name.toUpperCase()) return name;
  return name.toLowerCase().split(/(\s+|-|\/)/).map((w, i) => {
    const up = w.toUpperCase().replace(/[.,]/g, "");
    if (KEEP_UPPER.has(up)) return w.toUpperCase();
    if (i > 0 && SMALL.has(w)) return w;
    return w.replace(/^([a-z])/, (c) => c.toUpperCase()).replace(/(['’&])([a-z])/g, (_, p, c) => p + c);
  }).join("");
}

const year = new Date().getFullYear();

// Plain-English facts about a business, written as whole sentences so search engines and AI assistants
// can quote them, plus the questions people ask about it.
export function businessFacts(b: Profile) {
  const src = Object.fromEntries((b.sources ?? []).map((s) => [s.source, s.data as Record<string, any>]));  // eslint-disable-line @typescript-eslint/no-explicit-any
  const name = displayName(b.name);
  const industry = (industryLabel(b.naics) ?? b.industry ?? "business").toLowerCase();
  const where = b.city ? `${b.city}, Oklahoma` : "Oklahoma";
  const founded = [src.founded?.year, src.fdic?.founded, src.fmcsa?.registered, src.website_profile?.founded_year]
    .filter((y): y is number => typeof y === "number").sort((a, c) => a - c)[0] ?? null;
  const family = src.website_profile?.family_owned;
  const value = estimateValue({ ...b, public_company: !!src.sec || undefined, is_nonprofit: b.is_nonprofit || !!src.irs990 });
  const latest = b.headcounts?.length ? b.headcounts[b.headcounts.length - 1] : null;
  const employees = latest?.employees ?? b.jobs_reported;
  const reported = b.est_method === "reported" || b.est_method === "verified";
  const owner = b.owner_name ? `${b.owner_name}${b.owner_title && b.owner_title !== "Owner" ? ` (${b.owner_title})` : ""}` : null;

  const summary = [
    `${name} is ${family ? "a family-owned" : /^[aeiou]/.test(industry) ? "an" : "a"} ${industry} company in ${where}${founded ? `, in business since ${founded}` : ""}.`,
    owner ? `It is owned by ${owner}.` : null,
    b.est_method === "branch" ? `It is a location of ${b.parent_name}.` : `${reported ? "Its reported" : "Its estimated"} annual revenue is about ${money(b.est_revenue_mid)}${b.est_ebitda_mid != null ? `, with roughly ${money(b.est_ebitda_mid)} of EBITDA` : ""}.`,
    employees ? `It has about ${Number(employees).toLocaleString()} employees.` : null,
    value ? `Its estimated business value is ${money(value.mid)} (likely range ${money(value.low)}–${money(value.high)}).` : null,
    b.locations?.length ? `It has ${b.locations.length + 1} locations.` : null,
  ].filter(Boolean).join(" ");

  const faq: { q: string; a: string }[] = [];
  faq.push({
    q: `Who owns ${name}?`,
    a: owner
      ? `${name} is owned by ${owner}${b.owner_source ? ", according to public sources such as the company's website or filings" : ""}.`
      : `The owner of ${name} isn't in public records we've found yet. If you own or run the business, you can add or correct its details on SeeBITDA.`,
  });
  if (b.est_method !== "branch") {
    faq.push({ q: `How much revenue does ${name} make?`,
      a: reported ? `${name} reported revenue of about ${money(b.est_revenue_mid)}.`
        : `SeeBITDA estimates ${name}'s annual revenue at about ${money(b.est_revenue_mid)} (likely between ${money(b.est_revenue_low)} and ${money(b.est_revenue_high)}), based on public records such as its PPP loan and retirement-plan filings, brought up to ${year}.` });
  }
  if (value) faq.push({ q: `What is ${name} worth?`, a: `About ${money(value.mid)}, roughly ${value.multiple}× its estimated EBITDA of ${money(b.est_ebitda_mid)}, typical for a ${industry} company its size. Likely range: ${money(value.low)}–${money(value.high)}.` });
  if (employees) faq.push({ q: `How many employees does ${name} have?`, a: `About ${Number(employees).toLocaleString()}${latest ? `, from its ${latest.year} retirement-plan filing` : b.jobs_reported ? `, as reported on its PPP loan` : ""}.` });
  if (founded) faq.push({ q: `When was ${name} founded?`, a: `${name} has been in business since ${founded}.` });
  if (Number(b.sell_score) >= 40 && b.sell_signals?.length) {
    faq.push({ q: `Is ${name} for sale?`, a: `There's no public listing, but it shows signs that often come before a sale: ${b.sell_signals.slice(0, 3).join("; ").toLowerCase()}.` });
  }
  return { name, summary, faq, owner };
}
