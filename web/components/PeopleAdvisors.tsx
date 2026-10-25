import { money } from "@/lib/format";
import Icon from "./Icon";
import type { SourceRecord } from "./PublicRecords";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Person = { name: string; role: string; detail?: string; url?: string };
type Advisor = { kind: string; firm: string; detail: string; url?: string };

const ext = { target: "_blank", rel: "nofollow noopener noreferrer" } as const;
const ordinal = (n: number) => `${n}${["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]}`;
// "HOGAN TAYLOR LLP" -> "Hogan Taylor LLP": title case, but legal and professional suffixes stay capitals.
const tidy = (s: string) => (s === s.toUpperCase()
  ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\b(Llp|Llc|Pllc|Pc|Cpa|Cpas|Pa|Lp|Na|Ii|Iii)\b/g, (w) => w.toUpperCase())
  : s);

/** Company history, leadership and outside advisors, pieced together from public records. */
export default function PeopleAdvisors({ sources, lenders, owner }: {
  sources: SourceRecord[];
  lenders: string[];
  owner?: string | null;
}) {
  const by: Record<string, any> = Object.fromEntries(sources.map((s) => [s.source, s.data]));
  const web = by.website_profile ?? {};
  const people: Person[] = [];
  const seen = new Set(owner ? [owner.toLowerCase()] : []);
  const add = (p: Person) => {
    const key = p.name.toLowerCase();
    if (!seen.has(key)) { seen.add(key); people.push(p); }
  };
  for (const p of by.people_search?.people ?? []) add({ name: p.name, role: p.title, detail: "From a web search", url: p.url });
  for (const p of web.team ?? []) add({ name: p.name, role: p.title, detail: "Company website", url: p.url });
  for (const p of by.irs990_people?.officers ?? []) {
    add({ name: p.name, role: tidy(p.title || "Officer"), detail: p.pay > 0 ? `${money(p.pay)} pay (Form 990)` : "Form 990" });
  }
  if (by.form5500_people?.signer) {
    const s = by.form5500_people.signer;
    add({ name: s.name, role: "Signed for the company", detail: `${s.year} retirement-plan filing (Form 5500)` });
  }

  const advisors: Advisor[] = [];
  if (by.form5500_people?.auditor) {
    const a = by.form5500_people.auditor;
    advisors.push({ kind: "Accounting", firm: tidy(a.firm), detail: `Audits its 401(k) plan (${a.year} filing)` });
  }
  if (by.irs990_people?.preparer) {
    advisors.push({ kind: "Accounting", firm: tidy(by.irs990_people.preparer), detail: "Prepared its Form 990" });
  }
  for (const a of by.people_search?.advisors ?? []) advisors.push({ kind: a.kind, firm: a.firm, detail: "From a web search", url: a.url });
  const banks = [...new Set(lenders.filter(Boolean).map(tidy))];
  if (banks.length) advisors.push({ kind: "Banking", firm: banks.slice(0, 3).join(", "), detail: "PPP / SBA lender" });

  const history = web.founded_year || web.founder || web.family_owned || web.history_quote;
  if (!history && !people.length && !advisors.length) return null;

  return (
    <div className="section people">
      <h2>People &amp; advisors</h2>
      {history && (
        <div className="history">
          <div className="history-facts">
            {web.founded_year && <span>Founded {web.founded_year}{web.founder ? ` by ${web.founder}` : ""}</span>}
            {!web.founded_year && web.founder && <span>Founded by {web.founder}</span>}
            {web.family_owned && <span className="badge good">Family-owned{web.generation ? ` · ${ordinal(web.generation)} generation` : ""}</span>}
          </div>
          {web.history_quote && (
            <blockquote>
              &ldquo;{web.history_quote}&rdquo;
              {web.history_url && <a href={web.history_url} {...ext} aria-label="Source"><Icon name="external" size={13} /></a>}
            </blockquote>
          )}
        </div>
      )}
      {people.length > 0 && (
        <>
          <h3>Leadership</h3>
          <ul className="people-list">
            {people.slice(0, 12).map((p) => (
              <li key={p.name}>
                <div className="avatar sm">{p.name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}</div>
                <div>
                  <div className="who">{p.name}</div>
                  <div className="src">{p.role}{p.detail ? ` · ${p.detail}` : ""}
                    {p.url && <> · <a href={p.url} {...ext}>source</a></>}</div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {advisors.length > 0 && (
        <>
          <h3>Advisors</h3>
          <ul className="advisor-list">
            {advisors.map((a, i) => (
              <li key={i}><span className="kind">{a.kind}</span><b>{a.firm}</b>
                <span className="src">{a.detail}{a.url && <> · <a href={a.url} {...ext}>source</a></>}</span></li>
            ))}
          </ul>
        </>
      )}
      <p className="disclaimer">From the company&apos;s own website and public filings (DOL Form 5500, IRS Form 990, SBA).
        Roles are as stated there and may be out of date.</p>
    </div>
  );
}
