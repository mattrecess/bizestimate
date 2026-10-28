import { money } from "@/lib/format";
import Icon from "./Icon";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Prospect = { id: string; name: string; city: string; industry: string; est_revenue_mid: string | number | null; miles: number | null };
const ext = { target: "_blank", rel: "nofollow noopener noreferrer" } as const;

// What the business does, from its own website (website_offering).
export function WhatTheyDo({ offering, industry }: { offering: any; industry: string }) {
  if (!offering?.summary && !offering?.products?.length) return null;
  const list = (label: string, items?: string[]) => items?.length ? (
    <div className="offer-row"><span className="k">{label}</span><div className="tags">{items.map((t) => <span key={t} className="tag">{t}</span>)}</div></div>
  ) : null;
  return (
    <div className="section offering">
      <h2><Icon name="briefcase" size={16} />What they do</h2>
      {offering.summary && <p>{offering.summary}</p>}
      {list("Products & services", offering.products)}
      {list("Markets served", offering.markets)}
      {list("Service area", offering.areas)}
      {list("Certifications", offering.certifications)}
      <p className="disclaimer">From the company&apos;s <a href={offering.url} {...ext}>website</a>. Industry: {industry}.</p>
    </div>
  );
}

// Customers and suppliers: named on its website, federal agencies that awarded it contracts, its banks
// and auditor, and possible customers nearby in the markets it says it serves.
export function CustomersSuppliers({ offering, contracts, lenders, auditor, prospects, onSelect }: {
  offering: any; contracts: any; lenders: { name: string; loans: string[] }[]; auditor?: string | null;
  prospects: { market: string; items: Prospect[] }[]; onSelect?: (id: number) => void;
}) {
  const customers: string[] = offering?.customers ?? [];
  const agencies: { name: string; amount: number }[] = contracts?.agencies ?? [];
  const suppliers: string[] = offering?.suppliers ?? [];
  if (!customers.length && !agencies.length && !suppliers.length && !lenders.length && !auditor && !prospects.length) return null;
  const link = (p: Prospect) => onSelect
    ? <a href={`/business/${p.id}`} onClick={(e) => { e.preventDefault(); onSelect(Number(p.id)); }}>{p.name}</a>
    : <a href={`/business/${p.id}`}>{p.name}</a>;
  return (
    <div className="section offering">
      <h2><Icon name="store" size={16} />Customers &amp; suppliers</h2>
      <div className="cs-grid">
        {(customers.length > 0 || agencies.length > 0) && (
          <div>
            <h3>Customers</h3>
            <ul>
              {agencies.map((a) => <li key={a.name}>{a.name} <span className="muted">· federal contracts {money(a.amount)}</span></li>)}
              {customers.map((c) => <li key={c}>{c} <span className="muted">· named on its website</span></li>)}
            </ul>
          </div>
        )}
        {(suppliers.length > 0 || lenders.length > 0 || auditor) && (
          <div>
            <h3>Suppliers &amp; partners</h3>
            <ul>
              {suppliers.map((s) => <li key={s}>{s} <span className="muted">· brand it sells or installs</span></li>)}
              {lenders.map((l) => <li key={l.name}>{l.name} <span className="muted">· lender ({l.loans.join(", ")})</span></li>)}
              {auditor && <li>{auditor} <span className="muted">· 401(k) plan auditor (CPA)</span></li>}
            </ul>
          </div>
        )}
      </div>
      {prospects.length > 0 && (
        <>
          <h3>Possible customers nearby</h3>
          <p className="disclaimer" style={{ marginTop: 0 }}>The largest businesses within about 60 miles in the markets its website says it serves.</p>
          {prospects.map((g) => (
            <div key={g.market} className="prospects">
              <div className="k">{g.market}</div>
              <ul>{g.items.map((p) => <li key={p.id}>{link(p)} <span className="muted">· {p.city}{p.miles != null ? `, ${p.miles} mi` : ""} · {money(p.est_revenue_mid)}</span></li>)}</ul>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
