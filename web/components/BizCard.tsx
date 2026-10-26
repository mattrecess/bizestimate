import { money } from "@/lib/format";
import { industryLabel } from "@/lib/industries";
import { estimateValue } from "@/lib/valuation";
import Icon, { industryIcon } from "./Icon";

export type Biz = {
  id: number; name: string; city: string; zip: string; industry: string; naics: string | null;
  jobs_reported: number | null; est_revenue_mid: string; est_ebitda_mid: string;
  est_confidence: string; est_method: string; has_owner: boolean; has_website: boolean;
  is_nonprofit?: boolean; est_ebitda_low?: string; est_ebitda_high?: string; parent_name?: string | null; sell_score?: string | null;
  lenders?: { lender: string; program: string | null; year: number | null }[] | null;
};

export default function BizCard({ b, hovered, onOpen, onHover }: {
  b: Biz;
  hovered: boolean;
  onOpen: (id: number) => void;
  onHover: (id: number | null) => void;
}) {
  const avg = b.est_method === "industry_average";
  const value = estimateValue(b);
  return (
    <a
      href={`/business/${b.id}`} className={`card ${hovered ? "hovered" : ""}`}
      onClick={(e) => { if (!e.metaKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); onOpen(Number(b.id)); } }}
      onMouseEnter={() => onHover(Number(b.id))} onMouseLeave={() => onHover(null)}
    >
      <div className="card-top">
        <div className="ind-icon"><Icon name={industryIcon(b.naics)} /></div>
        <div style={{ minWidth: 0 }}>
          <div className="name">{b.name}</div>
          <div className="sub">{industryLabel(b.naics) ?? b.industry} · {b.city}, OK {b.zip}</div>
        </div>
      </div>
      {b.est_method === "branch" ? (
        <div className="card-figures"><span className="sub">Location of <b>{b.parent_name}</b></span></div>
      ) : <div className="card-figures">
        <div>
          <div className="rev-label">Est. revenue</div>
          <div className="rev">{money(b.est_revenue_mid)}</div>
        </div>
        <span className="stat-chip">EBITDA<b>{money(b.est_ebitda_mid)}</b></span>
        {value && <span className="stat-chip">Value<b>{money(value.mid)}</b></span>}
        {b.jobs_reported ? <span className="stat-chip">Employees<b>{b.jobs_reported}</b></span> : null}
      </div>}
      {b.lenders?.length ? (
        <div className="lender-line"><Icon name="bank" size={13} />
          {Object.entries(b.lenders.reduce<Record<string, string[]>>((acc, l) => {
            (acc[l.lender] ??= []).push([l.program, l.year].filter(Boolean).join(" "));
            return acc;
          }, {})).map(([name, loans]) => `${name} (${loans.join(", ")})`).join(" · ")}
        </div>
      ) : null}
      <div className="badges">
        {b.est_method === "branch" ? <span className="badge">Branch location</span>
          : avg ? <span className="badge">Industry avg</span>
          : b.est_method === "verified" ? <span className="badge good">Verified</span>
          : b.est_method === "reported" ? <span className="badge good">Reported</span>
          : b.est_method === "retirement_plan" ? <span className="badge good">401(k) data</span>
          : <span className="badge good">PPP data</span>}
        {Number(b.sell_score) >= 40 && <span className="badge warn">Likely to sell</span>}
        {b.has_owner && <span className="badge info"><Icon name="user" size={12} />Owner known</span>}
        {b.has_website && <span className="badge"><Icon name="globe" size={12} />Website</span>}
        {!avg && b.est_confidence === "low" && <span className="badge warn">Low confidence</span>}
      </div>
    </a>
  );
}
