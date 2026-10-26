import Link from "next/link";
import type { Industry } from "@/lib/industries";
import { slug, type Row, type Summary } from "@/lib/landing";
import { money } from "@/lib/format";

const businesses = (n: number) => `${n.toLocaleString()} ${n === 1 ? "business" : "businesses"}`;

// Shared by the industry page and the industry-in-a-city page.
export default function Landing({ ind, city, s, rows, cities }: {
  ind: Industry; city?: string; s: Summary; rows: Row[]; cities?: { city: string; count: number }[];
}) {
  const where = city ? `${city}, Oklahoma` : "Oklahoma";
  const mapLink = `/?q=${encodeURIComponent(ind.terms[0])}${city ? `&city=${encodeURIComponent(city)}` : ""}`;
  return (
    <main className="page landing">
      <nav className="crumbs">
        <Link href="/oklahoma">Oklahoma industries</Link> ›{" "}
        {city ? <><Link href={`/oklahoma/${slug(ind.label)}`}>{ind.label}</Link> › {city}</> : ind.label}
      </nav>
      <h1>{ind.label} in {where}</h1>
      <p className="lede">
        {businesses(s.count)} with estimated revenue, EBITDA and value, from public records. The typical one
        brings in about {money(s.revenue_median)} a year with roughly {money(s.ebitda_median)} of EBITDA.
      </p>
      <div className="tiles landing-tiles">
        <div className="tile"><div className="k">Businesses</div><div className="v">{s.count.toLocaleString()}</div></div>
        <div className="tile"><div className="k">Typical revenue</div><div className="v">{money(s.revenue_median)}</div></div>
        <div className="tile"><div className="k">Typical EBITDA</div><div className="v">{money(s.ebitda_median)}</div></div>
        <div className="tile"><div className="k">Combined revenue</div><div className="v">{money(s.revenue_total)}</div></div>
      </div>
      <p><Link className="btn primary" href={mapLink}>See them on the map</Link></p>

      <div className="section">
        <h2>Largest {ind.label.toLowerCase()} businesses{city ? ` in ${city}` : ""}</h2>
        <table>
          <thead><tr><th>#</th><th>Business</th>{!city && <th>City</th>}<th className="num">Est. revenue</th><th className="num hide-sm">Est. EBITDA</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td>{i + 1}</td>
                <td><Link href={`/business/${r.id}`}>{r.name}</Link></td>
                {!city && <td>{r.city}</td>}
                <td className="num">{money(r.est_revenue_mid)}</td>
                <td className="num hide-sm">{money(r.est_ebitda_mid)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {cities && cities.length > 0 && (
        <div className="section">
          <h2>By city</h2>
          <ul className="link-grid">
            {cities.map((c) => (
              <li key={c.city}><Link href={`/oklahoma/${slug(ind.label)}/${slug(c.city)}`}>{c.city}</Link> <span>{c.count.toLocaleString()}</span></li>
            ))}
          </ul>
        </div>
      )}
      <p className="disclaimer">Figures are estimates from public data (SBA loan records, Census and IRS industry
        statistics, and other public filings), not reported financials. <Link href="/methodology">How estimates work</Link>.</p>
    </main>
  );
}
