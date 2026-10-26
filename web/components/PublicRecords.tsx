import { money } from "@/lib/format";
import Icon from "./Icon";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type SourceRecord = { source: string; data: any };

const ext = { target: "_blank", rel: "nofollow noopener noreferrer" } as const;
const fmtDate = (d: string) => (d ? new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short" }) : "—");
const count = (n: any) => (n == null ? "—" : Number(n).toLocaleString());

// One card per public record we matched to this business; nothing renders for sources it lacks.
export default function PublicRecords({ sources }: { sources: SourceRecord[] }) {
  const by = Object.fromEntries(sources.map((s) => [s.source, s.data]));
  if (!sources.length) return null;
  return (
    <div className="section records">
      <h2>Public records</h2>
      <div className="record-grid">
        {by.sec && (
          <Record title="SEC filings" sub={`Public company${by.sec.tickers?.length ? ` · ${by.sec.tickers.join(", ")}` : ""}`} url={by.sec.url}>
            <Fact k={`Revenue (FY${by.sec.year})`} v={money(by.sec.revenue)} />
            {by.sec.ebitda != null && <Fact k="EBITDA" v={money(by.sec.ebitda)} />}
            {by.sec.net_income != null && <Fact k="Net income" v={money(by.sec.net_income)} />}
            {by.sec.assets != null && <Fact k="Total assets" v={money(by.sec.assets)} />}
          </Record>
        )}
        {by.irs990 && (
          <Record title="IRS Form 990" sub="Nonprofit" url={by.irs990.url}>
            <Fact k={`Revenue${by.irs990.year ? ` (${by.irs990.year})` : ""}`} v={money(by.irs990.revenue)} />
            {by.irs990.assets != null && <Fact k="Assets" v={money(by.irs990.assets)} />}
            {by.irs990.exempt_since && <Fact k="Tax-exempt since" v={String(by.irs990.exempt_since)} />}
          </Record>
        )}
        {by.fdic && (
          <Record title="FDIC call report" sub={by.fdic.holding_company ? `Bank · owned by ${by.fdic.holding_company}` : "Bank"} url={by.fdic.url}>
            <Fact k={`Revenue (${by.fdic.year})`} v={money(by.fdic.revenue)} />
            <Fact k="Pre-tax income" v={money(by.fdic.ebitda)} />
            <Fact k="Assets" v={money(by.fdic.assets)} />
            <Fact k="Deposits" v={money(by.fdic.deposits)} />
            {by.fdic.employees && <Fact k="Employees" v={count(by.fdic.employees)} />}
            {by.fdic.offices && <Fact k="Branches" v={count(by.fdic.offices)} />}
            {by.fdic.founded && <Fact k="Established" v={String(by.fdic.founded)} />}
          </Record>
        )}
        {by.sba && (
          <Record title="SBA loans" sub={by.sba.ownership_change_year ? `Changed ownership (SBA-financed, FY${by.sba.ownership_change_year})` : `${by.sba.loans.length} since 2020`}>
            <table className="mini"><tbody>
              {by.sba.loans.slice(0, 5).map((l: any, i: number) => (
                <tr key={i}>
                  <td>{fmtDate(l.date)}</td><td>{l.program}</td><td className="num">{money(l.amount)}</td>
                  <td className="hide-sm">{l.lender}</td>
                </tr>
              ))}
            </tbody></table>
            {by.sba.franchise && <Fact k="Franchise" v={by.sba.franchise} />}
          </Record>
        )}
        {by.linkedin?.company_url && (
          <Record title="LinkedIn company page" sub="Size as the company lists it" url={by.linkedin.company_url}>
            <Fact k="Employees" v={by.linkedin.size_min == null ? "—" : by.linkedin.size_max
              ? `${count(by.linkedin.size_min)}–${count(by.linkedin.size_max)}` : `${count(by.linkedin.size_min)}+`} />
          </Record>
        )}
        {by.contracts && (
          <Record title="Federal contracts" sub={(by.contracts.business_types || []).filter(niceType).slice(0, 3).map(typeLabel).join(" · ") || "USAspending.gov"} url={by.contracts.url}>
            <Fact k="Total, recent years" v={money(by.contracts.total)} />
            {Object.entries(by.contracts.by_year as Record<string, number>).reverse().slice(0, 4).map(([y, v]) => (
              <Fact key={y} k={`FY${y}`} v={money(v)} />
            ))}
          </Record>
        )}
        {by.fmcsa && (
          <Record title="DOT motor carrier" sub={`USDOT ${by.fmcsa.dot}${by.fmcsa.hazmat ? " · hazmat" : ""}`} url={by.fmcsa.url}>
            <Fact k="Trucks (power units)" v={count(by.fmcsa.power_units)} />
            <Fact k="Drivers" v={count(by.fmcsa.drivers)} />
            {by.fmcsa.miles ? <Fact k={`Miles${by.fmcsa.miles_year ? ` (${by.fmcsa.miles_year})` : ""}`} v={count(by.fmcsa.miles)} /> : null}
            {by.fmcsa.registered && <Fact k="Registered with DOT" v={String(by.fmcsa.registered)} />}
          </Record>
        )}
        {by.osha && (
          <Record title="OSHA inspections" sub={`${by.osha.count} since 2015`}>
            {by.osha.employees_latest ? <Fact k="Employees at last inspection" v={count(by.osha.employees_latest)} /> : null}
            <Fact k="Serious/repeat violations" v={count(by.osha.serious)} />
            <Fact k="Penalties" v={money(by.osha.penalties)} />
            <Fact k="Latest" v={fmtDate(by.osha.inspections[0]?.date)} />
          </Record>
        )}
      </div>
      <p className="disclaimer">Matched to this business by name and address from public government data; a match can
        occasionally be wrong.</p>
    </div>
  );
}

function Record({ title, sub, url, children }: { title: string; sub?: string; url?: string; children: React.ReactNode }) {
  return (
    <div className="record">
      <div className="record-head">
        <div><div className="record-title">{title}</div>{sub && <div className="record-sub">{sub}</div>}</div>
        {url && <a href={url} {...ext} aria-label={`${title} source`}><Icon name="external" size={14} /></a>}
      </div>
      {children}
    </div>
  );
}

const Fact = ({ k, v }: { k: string; v: string }) => (
  <div className="fact"><span>{k}</span><b>{v}</b></div>
);

// USAspending business types worth showing (ownership and certification, not the generic ones).
const TYPES: Record<string, string> = {
  veteran_owned_business: "Veteran-owned", service_disabled_veteran_owned_business: "Service-disabled veteran-owned",
  woman_owned_business: "Woman-owned", minority_owned_business: "Minority-owned", "8a_program_participant": "8(a)",
  historically_underutilized_business_zone: "HUBZone", historically_underutilized_business_firm: "HUBZone",
  native_american_owned_business: "Native American-owned", american_indian_owned_business: "Native American-owned",
  black_american_owned_business: "Black-owned", hispanic_american_owned_business: "Hispanic-owned",
  asian_pacific_american_owned_business: "Asian American-owned", women_owned_small_business: "Woman-owned",
  small_business: "Small business",
};
const niceType = (t: string) => t in TYPES;
const typeLabel = (t: string) => TYPES[t];
