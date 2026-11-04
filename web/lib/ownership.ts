// The ownership badge on every business page: who owns the company, by type. Strongest evidence first:
// SEC filings (public), a private-equity deal, an acquisition by another company, the company's own website
// (family-owned), the owner we found being its founder. Otherwise "Independently owned": privately held,
// but we haven't confirmed the founder still owns it.
import type { Transaction } from "./business";

export type Ownership = { label: string; kind: "public" | "pe" | "corporate" | "family" | "founder" | "independent";
  owner?: string; since?: string | null; detail?: string };

const PE_DEALS = /investment|recapitalization|buyout/i;
const CONTROL = /acquisition|merger/i;

export function ownershipType(b: { owner_title?: string | null; owner_name?: string | null },
  src: Record<string, any>, transactions: Transaction[] = []): Ownership {   // eslint-disable-line @typescript-eslint/no-explicit-any
  if (src.sec) return { label: "Public", kind: "public", detail: "Files annual reports with the SEC" };
  // Newest deal first (lib/business.ts orders them so).
  const pe = transactions.find((t) => t.investor || PE_DEALS.test(t.deal_type));
  if (pe) return { label: "PE-backed", kind: "pe", owner: pe.buyer, since: pe.deal_date, detail: `Private equity: ${pe.buyer}` };
  const bought = transactions.find((t) => CONTROL.test(t.deal_type));
  if (bought) return { label: "Corporate-owned", kind: "corporate", owner: bought.buyer, since: bought.deal_date, detail: `Owned by ${bought.buyer}` };
  if (src.website_profile?.family_owned) return { label: "Family-owned", kind: "family", detail: "Its website describes it as family-owned" };
  if (b.owner_name && /founder/i.test(b.owner_title ?? "")) return { label: "Founder-owned", kind: "founder", detail: `${b.owner_name} founded it` };
  return { label: "Independently owned", kind: "independent", detail: "Privately held; we haven't confirmed who founded it" };
}
