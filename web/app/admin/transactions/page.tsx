import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { businessId, isAdmin } from "@/lib/admin";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Transactions | Admin | SeeBITDA", robots: { index: false, follow: false } };

const TYPES = ["acquisition", "majority investment", "minority investment", "investment", "recapitalization", "merger", "management buyout"];
const dollars = (v: FormDataEntryValue | null) => {
  const m = String(v ?? "").trim().toLowerCase().replace(/[$,\s]/g, "").match(/^([\d.]+)([km]?)$/);
  return m ? Number(m[1]) * (m[2] === "m" ? 1e6 : m[2] === "k" ? 1e3 : 1) : null;
};

async function guard() { if (!(await isAdmin())) redirect("/admin"); }

async function save(form: FormData) {
  "use server";
  await guard();
  const id = businessId(String(form.get("business") ?? ""));
  const [b] = id ? await sql`select biz_key from businesses where id = ${id}` : [];
  const buyer = String(form.get("buyer") ?? "").trim();
  if (!b || !buyer) redirect("/admin/transactions?error=1");
  const type = TYPES.includes(String(form.get("deal_type"))) ? String(form.get("deal_type")) : "acquisition";
  // "2025" -> 2025-01-01, "2025-08" -> 2025-08-01, "2025-08-14" as is.
  const d = String(form.get("deal_date") ?? "").trim().match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
  const date = d ? `${d[1]}-${d[2] ?? "01"}-${d[3] ?? "01"}` : null;
  const text = (k: string) => String(form.get(k) ?? "").trim() || null;
  await sql`
    insert into transactions (biz_key, deal_date, buyer, deal_type, price, multiple, summary, source, source_url, is_public)
    values (${b.biz_key}, ${date}, ${buyer}, ${type}, ${dollars(form.get("price"))}, ${Number(form.get("multiple")) || null},
            ${text("summary")}, 'admin', ${text("source_url")}, ${form.get("is_public") === "on"})
    on conflict (biz_key, buyer) do update set deal_date = excluded.deal_date, deal_type = excluded.deal_type, price = excluded.price,
      multiple = excluded.multiple, summary = excluded.summary, source = 'admin', source_url = excluded.source_url, is_public = excluded.is_public`;
  revalidatePath("/admin/transactions");
  redirect("/admin/transactions?saved=1");
}

async function remove(form: FormData) {
  "use server";
  await guard();
  await sql`delete from transactions where id = ${String(form.get("id"))}`;
  redirect("/admin/transactions");
}

async function addInvestor(form: FormData) {
  "use server";
  await guard();
  const name = String(form.get("name") ?? "").trim(), url = String(form.get("url") ?? "").trim();
  if (name && /^https?:\/\//.test(url)) {
    await sql`insert into investors (name, url) values (${name}, ${url}) on conflict (name) do update set url = excluded.url, checked_at = null`;
  }
  redirect("/admin/transactions");
}

async function removeInvestor(form: FormData) {
  "use server";
  await guard();
  await sql`delete from investors where name = ${String(form.get("name"))}`;
  redirect("/admin/transactions");
}

type Row = { id: string; business_id: string; name: string; city: string; deal_date: string | null; buyer: string; deal_type: string;
  price: string | null; multiple: string | null; summary: string | null; source: string; source_url: string | null; is_public: boolean };

export default async function Transactions({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await guard();
  const params = await searchParams;
  const [rows, investors] = await Promise.all([
    sql<Row[]>`select t.id, b.id as business_id, b.name, b.city, to_char(t.deal_date, 'YYYY-MM-DD') as deal_date, t.buyer, t.deal_type,
                 t.price, t.multiple, t.summary, t.source, t.source_url, t.is_public
               from transactions t join businesses b on b.biz_key = t.biz_key order by t.deal_date desc nulls last, t.created_at desc`.catch(() => [] as Row[]),
    sql<{ name: string; url: string; checked_at: Date | null }[]>`select name, url, checked_at from investors order by name`.catch(() => []),
  ]);
  return (
    <main className="page admin">
      <div className="admin-head">
        <h1>Transactions</h1>
        <div className="admin-nav"><a href="/admin">Admin</a><a href="/deals">Public deals page</a></div>
      </div>
      <p className="disclaimer">Acquisitions and investments. Ones you add here win over those found automatically (news searches and
        investor portfolio pages). Price and multiple are never shown publicly; untick “Show publicly” to keep the whole deal private.</p>
      {params.saved && <p className="badge good">Saved</p>}
      {params.error && <p className="badge warn">Couldn&apos;t find that business, or the buyer was empty.</p>}
      <form action={save} className="admin-form">
        <input name="business" placeholder="Business link or number" required />
        <input name="buyer" placeholder="Buyer / investor" required />
        <select name="deal_type" defaultValue="acquisition">{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
        <input name="deal_date" placeholder="Date (2025-08 or 2025-08-01)" />
        <input name="price" placeholder="Price (private, e.g. 12M)" />
        <input name="multiple" placeholder="EBITDA multiple (private)" inputMode="decimal" />
        <input name="summary" placeholder="Summary" />
        <input name="source_url" placeholder="Source link" />
        <label className="check"><input type="checkbox" name="is_public" defaultChecked /> Show publicly</label>
        <button className="btn primary">Save deal</button>
      </form>
      {rows.length > 0 && (
        <table>
          <thead><tr><th>Business</th><th>Deal</th><th>Date</th><th className="num">Price / multiple</th><th>Source</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><a href={`/business/${r.business_id}`}>{r.name}</a><div className="disclaimer" style={{ margin: 0 }}>{r.city}{r.is_public ? "" : " · private"}</div></td>
                <td>{r.deal_type} · <b>{r.buyer}</b>{r.summary && <div className="disclaimer" style={{ margin: 0 }}>{r.summary}</div>}</td>
                <td>{r.deal_date ?? "—"}</td>
                <td className="num">{r.price ? money(r.price) : "—"}{r.multiple ? ` / ${Number(r.multiple)}×` : ""}</td>
                <td>{r.source_url ? <a href={r.source_url} target="_blank" rel="noopener noreferrer">{r.source}</a> : r.source}</td>
                <td><form action={remove}><input type="hidden" name="id" value={r.id} /><button className="link-btn">Remove</button></form></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2>Investors to watch</h2>
      <p className="disclaimer">Private equity firms, family offices and acquirers whose portfolio pages are checked monthly for Oklahoma
        companies we list. Add the firm&apos;s portfolio page (or homepage).</p>
      <form action={addInvestor} className="admin-form">
        <input name="name" placeholder="Firm name" required />
        <input name="url" placeholder="https://firm.com/portfolio" required />
        <button className="btn">Add investor</button>
      </form>
      <table><tbody>
        {investors.map((i) => (
          <tr key={i.name}><td><b>{i.name}</b></td><td><a href={i.url} target="_blank" rel="noopener noreferrer">{i.url}</a></td>
            <td className="disclaimer">{i.checked_at ? `checked ${new Date(i.checked_at).toLocaleDateString()}` : "not checked yet"}</td>
            <td><form action={removeInvestor}><input type="hidden" name="name" value={i.name} /><button className="link-btn">Remove</button></form></td></tr>
        ))}
      </tbody></table>
    </main>
  );
}
