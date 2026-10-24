import { money } from "@/lib/format";
import Icon, { industryIcon } from "./Icon";

export type Biz = {
  id: number; name: string; city: string; zip: string; industry: string; naics: string | null;
  jobs_reported: number | null; est_revenue_mid: string; est_ebitda_mid: string;
  est_confidence: string; est_method: string; has_owner: boolean; has_website: boolean;
};

export default function BizCard({ b, hovered, onOpen, onHover }: {
  b: Biz;
  hovered: boolean;
  onOpen: (id: number) => void;
  onHover: (id: number | null) => void;
}) {
  const avg = b.est_method === "industry_average";
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
          <div className="sub">{b.industry} · {b.city}, OK {b.zip}</div>
        </div>
      </div>
      <div className="card-figures">
        <div>
          <div className="rev-label">Est. revenue</div>
          <div className="rev">{money(b.est_revenue_mid)}</div>
        </div>
        <span className="stat-chip">EBITDA<b>{money(b.est_ebitda_mid)}</b></span>
        {b.jobs_reported ? <span className="stat-chip">Employees<b>{b.jobs_reported}</b></span> : null}
      </div>
      <div className="badges">
        {avg ? <span className="badge">Industry avg</span>
          : b.est_method === "retirement_plan" ? <span className="badge good">401(k) data</span>
          : <span className="badge good">PPP data</span>}
        {b.has_owner && <span className="badge info"><Icon name="user" size={12} />Owner known</span>}
        {b.has_website && <span className="badge"><Icon name="globe" size={12} />Website</span>}
        {!avg && b.est_confidence === "low" && <span className="badge warn">Low confidence</span>}
      </div>
    </a>
  );
}
