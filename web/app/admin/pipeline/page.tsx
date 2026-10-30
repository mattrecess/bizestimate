import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { isAdmin } from "@/lib/admin";
import { money } from "@/lib/format";
import { estimateValue } from "@/lib/valuation";

export const dynamic = "force-dynamic";
export const metadata = { title: "My pipeline | Admin | SeeBITDA", robots: { index: false, follow: false } };

const STATUSES: [string, string][] = [["watching", "Watching"], ["contacted", "Contacted"], ["talking", "Talking"], ["passed", "Passed"]];

type Row = {
  id: string; name: string; city: string; naics: string | null; is_nonprofit: boolean; owner_name: string | null;
  est_revenue_mid: string | null; est_ebitda_low: string | null; est_ebitda_mid: string | null; est_ebitda_high: string | null;
  status: string; follow_up: string | null; last_note: string | null; updated_at: Date;
};

export default async function Pipeline({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  if (!(await isAdmin())) redirect("/admin");
  const show = (await searchParams).status ?? "";
  const rows = await sql<Row[]>`
    select b.id, b.name, b.city, b.naics, b.is_nonprofit, b.owner_name, b.est_revenue_mid, b.est_ebitda_low, b.est_ebitda_mid, b.est_ebitda_high,
           p.status, to_char(p.follow_up, 'YYYY-MM-DD') as follow_up, p.updated_at,
           (select n.body from pipeline_notes n where n.biz_key = p.biz_key order by n.created_at desc limit 1) as last_note
    from pipeline p join businesses b on b.biz_key = p.biz_key
    ${show ? sql`where p.status = ${show}` : sql``}
    order by p.follow_up nulls last, p.updated_at desc`.catch(() => [] as Row[]);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <main className="page admin">
      <div className="admin-head">
        <h1>My pipeline</h1>
        <div className="admin-nav"><a href="/admin">Admin</a><a href={`/api/admin/mail-export?pipeline=1${show ? `&status=${show}` : ""}`}>Mailing list (CSV)</a></div>
      </div>
      <p className="disclaimer">Businesses you&apos;re tracking. Set the status, follow-up date and notes from any business&apos;s page
        while signed in. Private to you.</p>
      <div className="chips" style={{ margin: "10px 0 14px" }}>
        <Link className={`chip ${!show ? "selected" : ""}`} href="/admin/pipeline">All ({rows.length})</Link>
        {STATUSES.map(([k, label]) => <Link key={k} className={`chip ${show === k ? "selected" : ""}`} href={`/admin/pipeline?status=${k}`}>{label}</Link>)}
      </div>
      {!rows.length ? <p>Nothing here yet. Open a business and pick a status under “My pipeline”.</p> : (
        <table>
          <thead><tr><th>Business</th><th>Status</th><th>Follow up</th><th className="num">Est. value</th><th>Latest note</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const v = estimateValue(r);
              const due = r.follow_up && r.follow_up <= today;
              return (
                <tr key={r.id}>
                  <td><a href={`/business/${r.id}`}>{r.name}</a><div className="disclaimer" style={{ margin: 0 }}>{r.city}{r.owner_name ? ` · ${r.owner_name}` : ""}</div></td>
                  <td>{STATUSES.find(([k]) => k === r.status)?.[1] ?? r.status}</td>
                  <td>{r.follow_up ? <span className={due ? "badge warn" : ""}>{r.follow_up}{due ? " · due" : ""}</span> : "—"}</td>
                  <td className="num">{money(v ? v.mid : r.est_revenue_mid)}</td>
                  <td className="note-cell">{r.last_note ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
