import Link from "next/link";
import Footer from "@/components/Footer";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Recent Oklahoma business acquisitions & investments | BizEstimate",
  description: "Private equity investments, acquisitions and recapitalizations of Oklahoma private companies.",
  alternates: { canonical: "/deals" },
};

type Row = { id: string; name: string; city: string; industry: string; deal_date: string | null; buyer: string; deal_type: string; source_url: string | null };

export default async function Deals() {
  const rows = await sql<Row[]>`
    select b.id, b.name, b.city, b.industry, to_char(t.deal_date, 'YYYY-MM-DD') as deal_date, t.buyer, t.deal_type, t.source_url
    from transactions t join businesses b on b.biz_key = t.biz_key
    where t.is_public order by t.deal_date desc nulls last limit 300`.catch(() => [] as Row[]);
  return (
    <>
      <main className="page landing">
        <h1>Recent Oklahoma deals</h1>
        <p className="lede">Acquisitions, private equity investments and recapitalizations of Oklahoma private companies,
          from announcements, investors&apos; portfolio pages and our own research.</p>
        <div className="section">
          {!rows.length ? <p>No deals recorded yet.</p> : (
            <table>
              <thead><tr><th>Date</th><th>Company</th><th>Deal</th><th className="hide-sm">Industry</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.id}-${r.buyer}`}>
                    <td>{r.deal_date ? new Date(r.deal_date + "T00:00:00").toLocaleDateString(undefined, { year: "numeric", month: "short" }) : "—"}</td>
                    <td><Link href={`/business/${r.id}`}>{r.name}</Link><div className="disclaimer" style={{ margin: 0 }}>{r.city}</div></td>
                    <td>{r.deal_type === "acquisition" || r.deal_type === "merger" ? "Acquired by" : `${r.deal_type[0].toUpperCase()}${r.deal_type.slice(1)} from`}{" "}
                      <b>{r.buyer}</b>{r.source_url && <> · <a href={r.source_url} target="_blank" rel="nofollow noopener noreferrer">source</a></>}</td>
                    <td className="hide-sm">{r.industry}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
