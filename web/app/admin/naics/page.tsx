import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { isAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Industry codes | Admin | SeeBITDA", robots: { index: false, follow: false } };

type Fix = { id: string; biz_key: string; name: string; city: string; naics: string; recorded: string | null; label: string | null;
  recorded_label: string | null; source: string; note: string | null; updated_at: string };

async function guard() {
  if (!(await isAdmin())) redirect("/admin");
}

async function table() {
  await sql`create table if not exists naics_overrides (biz_key text primary key, naics text not null,
    source text not null default 'admin', note text, updated_at timestamptz not null default now())`;
  await sql`alter table businesses add column if not exists naics_recorded text`;
}

const labelFor = (code: string) => sql<{ label: string }[]>`select label from industry_benchmarks
  where ${code} like naics_prefix || '%' order by length(naics_prefix) desc limit 1`;

// "1302757", "seebitda.com/business/1302757", "https://www.seebitda.com/business/1302757?x" -> 1302757
const businessId = (v: FormDataEntryValue | null) => String(v ?? "").match(/(\d{3,})\D*$/)?.[1] ?? null;

// Saving shows the new code on the site straight away; the estimate follows with the next nightly load,
// which works it out from the corrected industry's figures.
async function save(form: FormData) {
  "use server";
  await guard();
  await table();
  const id = businessId(form.get("business"));
  const code = String(form.get("naics") ?? "").replace(/\D/g, "");
  if (!id || !/^\d{2,6}$/.test(code)) redirect("/admin/naics?error=input");
  const [b] = await sql`select biz_key, naics, naics_recorded from businesses where id = ${id}`;
  if (!b) redirect("/admin/naics?error=business");
  const note = String(form.get("note") ?? "").trim().slice(0, 500) || null;
  await sql`insert into naics_overrides (biz_key, naics, source, note) values (${b.biz_key}, ${code}, 'admin', ${note})
    on conflict (biz_key) do update set naics = excluded.naics, source = 'admin', note = excluded.note, updated_at = now()`;
  const [l] = await labelFor(code);
  // Keep the code the business filed (the first time it's corrected).
  await sql`update businesses set naics_recorded = coalesce(naics_recorded, naics), naics = ${code},
    industry = coalesce(${l?.label ?? null}, industry) where biz_key = ${b.biz_key}`;
  revalidatePath(`/business/${id}`);
  revalidatePath("/admin/naics");
  redirect("/admin/naics?saved=1");
}

async function remove(form: FormData) {
  "use server";
  await guard();
  const key = String(form.get("biz_key") ?? "");
  const [b] = await sql`select id, naics_recorded from businesses where biz_key = ${key}`;
  await sql`delete from naics_overrides where biz_key = ${key}`;
  if (b?.naics_recorded) {
    const [l] = await labelFor(b.naics_recorded);
    await sql`update businesses set naics = naics_recorded, naics_recorded = null,
      industry = coalesce(${l?.label ?? null}, industry) where biz_key = ${key}`;
    revalidatePath(`/business/${b.id}`);
  }
  revalidatePath("/admin/naics");
}

export default async function NaicsAdmin({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await guard();
  await table();
  const p = await searchParams;
  const fixes = await sql<Fix[]>`
    select b.id, o.biz_key, b.name, b.city, o.naics, b.naics_recorded as recorded, o.source, o.note, o.updated_at::text,
      (select label from industry_benchmarks where o.naics like naics_prefix || '%' order by length(naics_prefix) desc limit 1) as label,
      (select label from industry_benchmarks where b.naics_recorded like naics_prefix || '%' order by length(naics_prefix) desc limit 1) as recorded_label
    from naics_overrides o join businesses b on b.biz_key = o.biz_key
    order by o.updated_at desc limit 500`.catch(() => [] as Fix[]);
  return (
    <main className="page admin">
      <div className="admin-head">
        <h1>Industry codes</h1>
        <div className="admin-nav"><a href="/admin">Verified figures</a><a href="/admin/industries">Industry figures</a></div>
      </div>
      <p className="disclaimer">Correct a business&apos;s NAICS code when the one it filed (usually on its PPP loan) doesn&apos;t
        match what it does. The new code shows on the site at once; the estimate is redone with the corrected industry&apos;s
        figures in the next nightly load. The filed code is kept and shown alongside.</p>
      {p.saved && <p className="badge good">Saved</p>}
      {p.error === "input" && <p className="badge warn">Enter the business (its page link or number) and a 2–6 digit NAICS code.</p>}
      {p.error === "business" && <p className="badge warn">No business with that number.</p>}
      <form action={save} className="contact-form">
        <input name="business" placeholder="Business page link or number, e.g. seebitda.com/business/1302757" required />
        <input name="naics" placeholder="Correct NAICS code, e.g. 332311" inputMode="numeric" required />
        <input name="note" placeholder="Why (optional), e.g. makes metal building panels" />
        <button className="btn primary">Save correction</button>
      </form>
      <p className="disclaimer">Look codes up at <a href="https://www.census.gov/naics/" target="_blank" rel="noopener noreferrer">census.gov/naics</a>,
        or use the NAICS filter on the map.</p>
      <div className="section">
        <h2>Corrections ({fixes.length})</h2>
        {!fixes.length ? <p className="disclaimer">None yet.</p> : (
          <table>
            <thead><tr><th>Business</th><th>Filed code</th><th>Corrected to</th><th /></tr></thead>
            <tbody>
              {fixes.map((f) => (
                <tr key={f.id}>
                  <td><a href={`/business/${f.id}`}>{f.name}</a><div className="disclaimer" style={{ margin: 0 }}>{f.city}{f.note ? ` · ${f.note}` : ""}</div></td>
                  <td>{f.recorded ?? "—"}<div className="disclaimer" style={{ margin: 0 }}>{f.recorded_label}</div></td>
                  <td><b>{f.naics}</b><div className="disclaimer" style={{ margin: 0 }}>{f.label}{f.source !== "admin" ? ` · ${f.source}` : ""}</div></td>
                  <td><form action={remove}><input type="hidden" name="biz_key" value={f.biz_key} />
                    <button className="link-btn">Undo</button></form></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
