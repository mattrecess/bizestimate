// The ownership badge on every business page: who owns the company, by type. Strongest evidence first:
// SEC filings (public), a private-equity deal, an acquisition by another company, the company's own website
// (family-owned), the owner's family name on a decades-old company (family-owned), any other known owner
// (founder-owned). Otherwise "Independently owned": privately held, owner not found yet.
import type { Transaction } from "./business";

export type Ownership = { label: string; kind: "public" | "pe" | "corporate" | "family" | "founder" | "independent";
  owner?: string; ownerUrl?: string | null; since?: string | null; detail?: string };

const PE_DEALS = /investment|recapitalization|buyout/i;
const CONTROL = /acquisition|merger/i;

export function ownershipType(b: { owner_title?: string | null; owner_name?: string | null; name?: string | null; founded?: number | null },
  src: Record<string, any>, transactions: Transaction[] = []): Ownership {   // eslint-disable-line @typescript-eslint/no-explicit-any
  if (src.sec) return { label: "Public", kind: "public", detail: "Files annual reports with the SEC" };
  // Newest deal first (lib/business.ts orders them so).
  const pe = transactions.find((t) => t.investor || PE_DEALS.test(t.deal_type));
  // The firm's own site: its homepage, from the address saved for it in /admin's investors list.
  const site = (() => { try { return pe?.investor_url ? new URL(pe.investor_url).origin : null; } catch { return null; } })();
  if (pe) return { label: "PE-backed", kind: "pe", owner: pe.buyer, ownerUrl: site, since: pe.deal_date, detail: `Private equity: ${pe.buyer}` };
  const bought = transactions.find((t) => CONTROL.test(t.deal_type));
  if (bought) return { label: "Corporate-owned", kind: "corporate", owner: bought.buyer, since: bought.deal_date, detail: `Owned by ${bought.buyer}` };
  if (src.website_profile?.family_owned) return { label: "Family-owned", kind: "family", detail: "Its website describes it as family-owned" };
  if (b.owner_name) {
    // The owner's surname is the company's name and the company is decades old: a family business a
    // generation or more on (Sam Minick at Minick Materials, founded 1958).
    const surname = b.owner_name.trim().split(/\s+/).filter((w) => !/^(jr|sr|ii|iii|iv)\.?$/i.test(w)).pop()?.toUpperCase().replace(/[^A-Z]/g, "");
    const inName = !!surname && surname.length >= 3 && new RegExp(`\\b${surname}\\b`).test((b.name ?? "").toUpperCase());
    if (inName && b.founded && new Date().getFullYear() - b.founded >= 25) {
      return { label: "Family-owned", kind: "family", detail: `The ${surname[0]}${surname.slice(1).toLowerCase()} family's name has been on the company since ${b.founded}` };
    }
    return { label: "Founder-owned", kind: "founder", detail: `Owned by ${b.owner_name}` };
  }
  return { label: "Independently owned", kind: "independent", detail: "Privately held; we haven't found the owner yet" };
}
