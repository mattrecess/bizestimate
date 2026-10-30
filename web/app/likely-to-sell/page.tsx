import Link from "next/link";
import Footer from "@/components/Footer";
import { sql } from "@/lib/db";
import { money } from "@/lib/format";
import { INDUSTRIES } from "@/lib/industries";
import { industryBySlug, slug } from "@/lib/landing";
import { industryMatch, valueSql } from "@/lib/queries";

export const metadata = {
  title: "Oklahoma businesses likely to sell | SeeBITDA",
  description: "Oklahoma private businesses showing signs of an upcoming sale: decades in business, founder still in charge, no successor, shrinking headcount.",
  alternates: { canonical: "/likely-to-sell" },
};

const MIN_SCORE = 40;
const REVENUE = [["", "Any revenue"], ["1000000", "$1M+"], ["2000000", "$2M+"], ["5000000", "$5M+"], ["10000000", "$10M+"], ["25000000", "$25M+"]];

type Row = { id: string; name: string; city: string; industry: string; est_revenue_mid: string | null; value: string | null;
  sell_score: number; sell_signals: string[] | null; owner_name: string | null };

export default async function LikelyToSell({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const p = await searchParams;
  const ind = p.industry ? industryBySlug(p.industry) : null;
  const city = (p.city ?? "").trim();
  const min = Number(p.min) || 0;
  const where = sql`not is_individual and coalesce(est_method, '') <> 'branch' and sell_score >= ${MIN_SCORE}
    ${ind ? sql`and (${industryMatch(ind.naics)})` : sql``}
    ${city ? sql`and lower(city) = ${city.toLowerCase()}` : sql``}
    ${min ? sql`and est_revenue_mid >= ${min}` : sql``}`;
  const [rows, [{ count }]] = await Promise.all([
    sql<Row[]>`select id, name, city, industry, est_revenue_mid, ${valueSql} as value, sell_score, sell_signals, owner_name
      from businesses where ${where} order by sell_score desc, est_revenue_mid desc nulls last, id limit 100`.catch(() => [] as Row[]),
    sql<{ count: number }[]>`select count(*)::int as count from businesses where ${where}`.catch(() => [{ count: 0 }]),
  ]);
  return (
    <>
      <main className="page landing">
        <h1>Oklahoma businesses likely to sell</h1>
        <p className="lede">
          {count.toLocaleString()} businesses{ind ? ` in ${ind.label.toLowerCase()}` : ""}{city ? ` in ${city}` : ""} show
          several signs that an owner may be getting ready to sell: decades in business, the founder still running it, no
          family successor, or a shrinking workforce. Signals, not certainties: a good list to start conversations from.
        </p>
        <form className="sell-filters" method="get">
          <select name="industry" defaultValue={p.industry ?? ""} aria-label="Industry">
            <option value="">All industries</option>
            {INDUSTRIES.map((i) => <option key={i.label} value={slug(i.label)}>{i.label}</option>)}
          </select>
          <input name="city" defaultValue={city} placeholder="City" aria-label="City" />
          <select name="min" defaultValue={p.min ?? ""} aria-label="Revenue">
            {REVENUE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button className="btn primary">Show</button>
        </form>
        <div className="section">
          {!rows.length ? <p className="disclaimer">No businesses match. Try fewer filters.</p> : (
            <table className="sell-table">
              <thead><tr><th>Business</th><th className="num">Est. revenue</th><th className="num hide-sm">Est. value</th><th className="num">Score</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/business/${r.id}`}><b>{r.name}</b></Link>
                      <div className="disclaimer" style={{ margin: 0 }}>{[r.city, r.industry, r.owner_name && `Owner: ${r.owner_name}`].filter(Boolean).join(" · ")}</div>
                      {r.sell_signals?.length ? <ul className="signals">{r.sell_signals.map((s) => <li key={s}>{s}</li>)}</ul> : null}
                    </td>
                    <td className="num">{money(r.est_revenue_mid)}</td>
                    <td className="num hide-sm">{money(r.value)}</td>
                    <td className="num"><span className="badge warn">{r.sell_score}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {count > rows.length && <p className="disclaimer">Showing the top {rows.length} of {count.toLocaleString()}. Narrow by industry, city or revenue to see more.</p>}
        </div>
        <div className="section">
          <h2>How the score works</h2>
          <p>Points for years in business (15, 25 and 40+ years), a founder still in charge after 20 years, no family member
            on the team after 25 years, and a headcount down 20% or more on recent retirement-plan filings. Points come off
            for family already in the business and for a recent sale or investment. Businesses scoring {MIN_SCORE}+ are listed.
            Founding years come from public records and the company&apos;s own website; see the <Link href="/methodology">methodology</Link>.</p>
        </div>
      </main>
      <Footer />
    </>
  );
}
