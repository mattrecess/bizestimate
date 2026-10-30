import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { isAdmin } from "@/lib/admin";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Corrections | Admin | SeeBITDA", robots: { index: false, follow: false } };

type Row = { id: string; business_id: string; name: string; city: string; website: string | null; relationship: string;
  person: string | null; email: string; revenue: string | null; ebitda: string | null; employees: number | null;
  year: number | null; show_publicly: boolean; message: string | null; status: string; created_at: string;
  est_revenue_mid: string | null; est_ebitda_mid: string | null };

async function guard() {
  if (!(await isAdmin())) redirect("/admin");
}

// Apply: the figures become verified figures (shown publicly only if the owner asked), like those entered in /admin.
async function apply(form: FormData) {
  "use server";
  await guard();
  const id = String(form.get("id") ?? "");
  const [c] = await sql`select * from estimate_corrections where id = ${id}`;
  if (!c) redirect("/admin/corrections");
  if (c.revenue || c.ebitda) {
    await sql`
      insert into known_financials (biz_key, revenue, ebitda, year, note, is_public, updated_at)
      values (${c.biz_key}, ${c.revenue}, ${c.ebitda}, ${c.year}, ${`From ${c.relationship} via /correct (${c.email})`}, ${c.show_publicly}, now())
      on conflict (biz_key) do update set revenue = coalesce(excluded.revenue, known_financials.revenue),
        ebitda = coalesce(excluded.ebitda, known_financials.ebitda), year = excluded.year, note = excluded.note,
        is_public = excluded.is_public, updated_at = now()`;
  }
  await sql`update estimate_corrections set status = 'applied' where id = ${id}`;
  revalidatePath("/admin/corrections");
}

async function dismiss(form: FormData) {
  "use server";
  await guard();
  await sql`update estimate_corrections set status = 'dismissed' where id = ${String(form.get("id") ?? "")}`;
  revalidatePath("/admin/corrections");
}

const domain = (s: string | null) => (s ?? "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];

export default async function Corrections() {
  await guard();
  const rows = await sql<Row[]>`
    select c.id, b.id as business_id, b.name, b.city, b.website, c.relationship, c.name as person, c.email, c.revenue, c.ebitda,
           c.employees, c.year, c.show_publicly, c.message, c.status, c.created_at::text, b.est_revenue_mid, b.est_ebitda_mid
    from estimate_corrections c join businesses b on b.biz_key = c.biz_key
    order by (c.status = 'new') desc, c.created_at desc limit 200`.catch(() => [] as Row[]);
  return (
    <main className="page admin">
      <div className="admin-head">
        <h1>Owner corrections</h1>
        <div className="admin-nav"><a href="/admin">Verified figures</a><a href="/admin/pipeline">My pipeline</a><a href="/admin/contacts">Contacts</a></div>
      </div>
      <p className="disclaimer">Figures owners sent through the &ldquo;Correct these figures&rdquo; link. Applying one saves it as a
        verified figure: private (tunes the accuracy report) unless the owner asked for it to be shown. Check the email domain
        against the company&apos;s website, and email them if anything looks off.</p>
      {!rows.length ? <p>None yet.</p> : (
        <table>
          <thead><tr><th>Business</th><th>From</th><th className="num">Revenue (theirs / ours)</th><th className="num">EBITDA (theirs / ours)</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => {
              const match = domain(r.website) && r.email.toLowerCase().endsWith(`@${domain(r.website)}`);
              return (
                <tr key={r.id} style={r.status !== "new" ? { opacity: 0.55 } : undefined}>
                  <td><a href={`/business/${r.business_id}`}>{r.name}</a><div className="disclaimer" style={{ margin: 0 }}>{r.city} · {r.created_at.slice(0, 10)}{r.year ? ` · figures for ${r.year}` : ""}</div>
                    {r.message && <div className="disclaimer" style={{ margin: 0 }}>&ldquo;{r.message}&rdquo;</div>}</td>
                  <td>{r.person ?? "—"} ({r.relationship})<div className="disclaimer" style={{ margin: 0 }}>{r.email}{" "}
                    {match ? <span className="badge good">domain matches</span> : <span className="badge warn">check domain</span>}</div>
                    {r.employees ? <div className="disclaimer" style={{ margin: 0 }}>{r.employees} employees</div> : null}
                    {r.show_publicly && <div className="disclaimer" style={{ margin: 0 }}>Wants it shown publicly</div>}</td>
                  <td className="num">{money(r.revenue)} / {money(r.est_revenue_mid)}</td>
                  <td className="num">{money(r.ebitda)} / {money(r.est_ebitda_mid)}</td>
                  <td>{r.status === "new" ? (
                    <>
                      <form action={apply}><input type="hidden" name="id" value={r.id} /><button className="btn primary">Apply</button></form>
                      <form action={dismiss}><input type="hidden" name="id" value={r.id} /><button className="link-btn">Dismiss</button></form>
                    </>
                  ) : r.status}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
