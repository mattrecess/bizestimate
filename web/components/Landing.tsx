import Link from "next/link";
import type { Industry } from "@/lib/industries";
import { slug, type Row, type Summary } from "@/lib/landing";
import { money } from "@/lib/format";
import { SITE_URL } from "@/lib/site";

const businesses = (n: number) => `${n.toLocaleString()} ${n === 1 ? "business" : "businesses"}`;

type Seller = Row & { sell_score: number; sell_signals: string[] | null };
type Deal = { id: string; name: string; city: string; buyer: string; deal_date: string | null; deal_type: string | null };

// A market report for the industry page and the industry-in-a-city page: how many, how big, what
// they're worth, who might sell, recent deals, the largest.
export default function Landing({ ind, city, s, rows, cities, sellers = [], deals = [] }: {
  ind: Industry; city?: string; s: Summary; rows: Row[]; cities?: { city: string; count: number }[];
  sellers?: Seller[]; deals?: Deal[];
}) {
  const bands: [string, number][] = [["Under $1M", s.bands.under1], ["$1–5M", s.bands.m1to5], ["$5–25M", s.bands.m5to25], ["$25M+", s.bands.over25]];
  const widest = Math.max(1, ...bands.map(([, n]) => n));
  const sellLink = `/likely-to-sell?industry=${slug(ind.label)}${city ? `&city=${encodeURIComponent(city)}` : ""}`;
  const where = city ? `${city}, Oklahoma` : "Oklahoma";
  const mapLink = `/?q=${encodeURIComponent(ind.terms[0])}${city ? `&city=${encodeURIComponent(city)}` : ""}`;
  const base = `${SITE_URL}/oklahoma/${slug(ind.label)}`;
  const ld = [
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Oklahoma industries", item: `${SITE_URL}/oklahoma` },
      { "@type": "ListItem", position: 2, name: ind.label, item: base },
      ...(city ? [{ "@type": "ListItem", position: 3, name: city, item: `${base}/${slug(city)}` }] : []),
    ] },
    { "@context": "https://schema.org", "@type": "ItemList", name: `Largest ${ind.label.toLowerCase()} businesses in ${where}`,
      itemListElement: rows.slice(0, 20).map((r, i) => ({ "@type": "ListItem", position: i + 1, name: r.name, url: `${SITE_URL}/business/${r.id}` })) },
  ];
  return (
    <main className="page landing">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
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
        <div className="tile"><div className="k">Typical value</div><div className="v">{money(s.value_median)}</div>
          {s.multiple_median ? <div className="r">about {Number(s.multiple_median).toFixed(1)}× EBITDA</div> : null}</div>
        <div className="tile"><div className="k">Combined revenue</div><div className="v">{money(s.revenue_total)}</div></div>
        <div className="tile"><div className="k">Likely to sell</div><div className="v">{s.likely_to_sell.toLocaleString()}</div></div>
      </div>
      <p><Link className="btn primary" href={mapLink}>See them on the map</Link>{" "}
        {s.likely_to_sell > 0 && <Link className="btn" href={sellLink}>Likely to sell</Link>}</p>

      <div className="section">
        <h2>How big they are</h2>
        <div className="bands">
          {bands.map(([label, n]) => (
            <div key={label} className="band">
              <span className="band-label">{label}</span>
              <span className="band-bar"><span style={{ width: `${(100 * n) / widest}%` }} /></span>
              <span className="band-n">{n.toLocaleString()}</span>
            </div>
          ))}
        </div>
        <p className="disclaimer">By estimated annual revenue.</p>
      </div>

      {sellers.length > 0 && (
        <div className="section">
          <h2>Most likely to sell</h2>
          <ul className="report-list">
            {sellers.map((r) => (
              <li key={r.id}><Link href={`/business/${r.id}`}><b>{r.name}</b></Link> <span className="muted">{r.city} · {money(r.est_revenue_mid)}</span>
                {r.sell_signals?.length ? <div className="disclaimer" style={{ margin: 0 }}>{r.sell_signals.slice(0, 2).join(" · ")}</div> : null}</li>
            ))}
          </ul>
          <p><Link href={sellLink}>All {s.likely_to_sell.toLocaleString()} likely sellers →</Link></p>
        </div>
      )}

      {deals.length > 0 && (
        <div className="section">
          <h2>Recent deals</h2>
          <ul className="report-list">
            {deals.map((d) => (
              <li key={`${d.id}-${d.buyer}`}><Link href={`/business/${d.id}`}><b>{d.name}</b></Link>{" "}
                <span className="muted">{d.deal_type === "acquisition" || d.deal_type === "merger" ? "acquired by" : "investment from"} {d.buyer}
                  {d.deal_date ? ` · ${d.deal_date.slice(0, 7)}` : ""}</span></li>
            ))}
          </ul>
        </div>
      )}

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
