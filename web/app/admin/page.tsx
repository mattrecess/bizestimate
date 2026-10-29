import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { money } from "@/lib/format";
import { estimateValue } from "@/lib/valuation";
import { adminConfigured, businessId, isAdmin, signIn, signOut } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin | BizEstimate", robots: { index: false, follow: false } };

type Row = {
  id: string; name: string; city: string; revenue: string | null; ebitda: string | null; year: number | null;
  note: string | null; is_public: boolean; est_revenue_mid: string | null; est_ebitda_mid: string | null; est_method: string;
  est_revenue_by_employees: string | null; est_revenue_by_payroll: string | null;
  sale_price: string | null; sale_year: number | null; naics: string | null; is_nonprofit: boolean;
};

const dollars = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim().toLowerCase().replace(/[$,\s]/g, "");
  const m = s.match(/^([\d.]+)([km]?)$/);
  if (!m) return null;
  return Number(m[1]) * (m[2] === "m" ? 1e6 : m[2] === "k" ? 1e3 : 1);
};

async function login(form: FormData) {
  "use server";
  await signIn(String(form.get("password") ?? ""));
  redirect("/admin");
}

async function logout() {
  "use server";
  await signOut();
  redirect("/admin");
}

async function save(form: FormData) {
  "use server";
  if (!(await isAdmin())) redirect("/admin");
  const id = businessId(String(form.get("business") ?? ""));
  if (!id) redirect("/admin?error=business");
  const [b] = await sql`select biz_key from businesses where id = ${id}`;
  if (!b) redirect("/admin?error=business");
  const revenue = dollars(form.get("revenue"));
  const ebitda = dollars(form.get("ebitda"));
  const year = Number(form.get("year")) || null;
  const isPublic = form.get("is_public") === "on";
  const salePrice = dollars(form.get("sale_price"));
  const saleYear = Number(form.get("sale_year")) || null;
  await sql`
    insert into known_financials (biz_key, revenue, ebitda, year, note, is_public, sale_price, sale_year, updated_at)
    values (${b.biz_key}, ${revenue}, ${ebitda}, ${year}, ${String(form.get("note") ?? "") || null}, ${isPublic}, ${salePrice}, ${saleYear}, now())
    on conflict (biz_key) do update set revenue = excluded.revenue, ebitda = excluded.ebitda, year = excluded.year,
      note = excluded.note, is_public = excluded.is_public, sale_price = excluded.sale_price, sale_year = excluded.sale_year,
      updated_at = now()`;
  revalidatePath("/admin");
  redirect("/admin?saved=1");
}

// Owners entered by hand: shown on the profile at once, and kept over found owners on every load.
async function saveOwner(form: FormData) {
  "use server";
  if (!(await isAdmin())) redirect("/admin");
  const id = businessId(String(form.get("business") ?? ""));
  const [b] = id ? await sql`select biz_key from businesses where id = ${id}` : [];
  const name = String(form.get("owner_name") ?? "").trim();
  if (!b || !name) redirect("/admin?error=owner");
  const title = String(form.get("owner_title") ?? "").trim() || "Owner";
  const note = String(form.get("note") ?? "").trim() || null;
  await sql`insert into known_owners (biz_key, owner_name, owner_title, note, updated_at)
            values (${b.biz_key}, ${name}, ${title}, ${note}, now())
            on conflict (biz_key) do update set owner_name = excluded.owner_name, owner_title = excluded.owner_title,
              note = excluded.note, updated_at = now()`;
  await sql`update businesses set owner_name = ${name}, owner_title = ${title}, owner_source = null where biz_key = ${b.biz_key}`;
  revalidatePath("/admin");
  redirect("/admin?owner=1");
}

async function removeOwner(form: FormData) {
  "use server";
  if (!(await isAdmin())) redirect("/admin");
  // The owner found automatically (if any) comes back with the next data load.
  await sql`delete from known_owners where biz_key = ${String(form.get("biz_key"))}`;
  await sql`update businesses set owner_name = null, owner_title = null, owner_source = null where biz_key = ${String(form.get("biz_key"))}`;
  redirect("/admin");
}

async function remove(form: FormData) {
  "use server";
  if (!(await isAdmin())) redirect("/admin");
  const id = businessId(String(form.get("id") ?? ""));
  if (id) await sql`delete from known_financials where biz_key = (select biz_key from businesses where id = ${id})`;
  redirect("/admin");
}

const ratio = (est: string | null, actual: string | null) =>
  est && actual && Number(actual) > 0 ? Number(est) / Number(actual) : null;

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
}

export default async function Admin({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const params = await searchParams;
  if (!adminConfigured()) {
    return <main className="page"><h1>Admin</h1><p>Set an <code>ADMIN_PASSWORD</code> environment variable in Vercel to enable this page.</p></main>;
  }
  if (!(await isAdmin())) {
    return (
      <main className="page">
        <h1>Admin</h1>
        <form action={login} className="admin-form">
          <input type="password" name="password" placeholder="Password" autoFocus required />
          <button className="btn primary">Sign in</button>
        </form>
      </main>
    );
  }
  const owners = await sql<{ id: string; biz_key: string; name: string; city: string; owner_name: string; owner_title: string | null; note: string | null }[]>`
    select b.id, k.biz_key, b.name, b.city, k.owner_name, k.owner_title, k.note
    from known_owners k join businesses b on b.biz_key = k.biz_key order by k.updated_at desc`.catch(() => []);
  const rows = await sql<Row[]>`
    select b.id, b.name, b.city, k.revenue, k.ebitda, k.year, k.note, k.is_public,
           b.est_revenue_mid, b.est_ebitda_mid, b.est_method, b.est_revenue_by_employees, b.est_revenue_by_payroll, k.sale_price, k.sale_year, b.naics, b.is_nonprofit
    from known_financials k join businesses b on b.biz_key = k.biz_key order by k.updated_at desc`.catch(() => [] as Row[]);
  // Accuracy of what the site would show without these figures (private rows only: public ones
  // already replace the estimate).
  const rev = rows.filter((r) => !r.is_public).map((r) => ratio(r.est_revenue_mid, r.revenue)).filter((x): x is number => x != null);
  const ebi = rows.filter((r) => !r.is_public).map((r) => ratio(r.est_ebitda_mid, r.ebitda)).filter((x): x is number => x != null);
  // The two PPP-based methods on their own, to see which to lean on (the blend weights them equally).
  const byEmp = rows.filter((r) => !r.is_public).map((r) => ratio(r.est_revenue_by_employees, r.revenue)).filter((x): x is number => x != null);
  const byPay = rows.filter((r) => !r.is_public).map((r) => ratio(r.est_revenue_by_payroll, r.revenue)).filter((x): x is number => x != null);
  const off = (xs: number[]) => median(xs.map((x) => Math.abs(Math.log(x))));
  // Typical miss as a factor: 1.5× means the estimate is usually within 1.5× of the actual, either way.
  const factor = (x: number | null) => (x == null ? "—" : `${Math.exp(x).toFixed(1)}×`);
  const bias = (xs: number[]) => { const m = median(xs); return m == null ? "—" : `${m >= 1 ? "+" : ""}${Math.round((m - 1) * 100)}%`; };

  return (
    <main className="page admin">
      <div className="admin-head">
        <h1>Verified figures</h1>
        <div className="admin-nav"><a href="/admin/industries">Industry figures</a><a href="/admin/corrections">Owner corrections</a><a href="/admin/pipeline">My pipeline</a><a href="/admin/transactions">Transactions</a><a href="/admin/contacts">Contacts &amp; requests</a><form action={logout}><button className="link-btn">Sign out</button></form></div>
      </div>
      <p className="disclaimer">Actual revenue and EBITDA you know for a business. Private by default: they&apos;re used only
        to measure and tune the estimates. Tick &ldquo;show publicly&rdquo; only when the figures may appear on the site.</p>
      {params.saved && <p className="badge good">Saved</p>}
      {params.error && <p className="badge warn">Couldn&apos;t find that business. Paste its page link or number.</p>}
      <form action={save} className="admin-form">
        <input name="business" placeholder="Business link or number (…/business/1316278)" required />
        <input name="revenue" placeholder="Revenue (e.g. 15M)" />
        <input name="ebitda" placeholder="EBITDA (e.g. 2M)" />
        <input name="year" placeholder="Year (optional)" inputMode="numeric" />
        <input name="sale_price" placeholder="Sale price, if sold (e.g. 9M)" />
        <input name="sale_year" placeholder="Sale year" inputMode="numeric" />
        <input name="note" placeholder="Note (private)" />
        <label className="check"><input type="checkbox" name="is_public" /> Show publicly</label>
        <button className="btn primary">Save</button>
      </form>

      <h2>Owners</h2>
      <p className="disclaimer">Owners you know: shown on the business&apos;s public page right away, and kept over any owner
        found automatically. The note stays private.</p>
      {params.owner && <p className="badge good">Owner saved</p>}
      {params.error === "owner" && <p className="badge warn">Couldn&apos;t find that business, or the name was empty.</p>}
      <form action={saveOwner} className="admin-form">
        <input name="business" placeholder="Business link or number" required />
        <input name="owner_name" placeholder="Owner's name" required />
        <input name="owner_title" placeholder="Title (default Owner)" />
        <input name="note" placeholder="Source (private)" />
        <button className="btn primary">Save owner</button>
      </form>
      {owners.length > 0 && (
        <table>
          <thead><tr><th>Business</th><th>Owner</th><th /></tr></thead>
          <tbody>
            {owners.map((o) => (
              <tr key={o.biz_key}>
                <td><a href={`/business/${o.id}`}>{o.name}</a><div className="disclaimer" style={{ margin: 0 }}>{o.city}</div></td>
                <td>{o.owner_name}{o.owner_title ? `, ${o.owner_title}` : ""}{o.note && <div className="disclaimer" style={{ margin: 0 }}>{o.note}</div>}</td>
                <td><form action={removeOwner}><input type="hidden" name="biz_key" value={o.biz_key} /><button className="link-btn">Remove</button></form></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Accuracy</h2>
      {rows.length > 0 && (
        <>
          <div className="tiles admin-stats">
            <div className="tile"><div className="k">Businesses</div><div className="v">{rows.length}</div></div>
            <div className="tile"><div className="k">Revenue: typically off by</div><div className="v">{factor(off(rev))}</div><div className="r">typically {bias(rev)} vs actual</div></div>
            <div className="tile"><div className="k">EBITDA: typically off by</div><div className="v">{factor(off(ebi))}</div><div className="r">typically {bias(ebi)} vs actual</div></div>
            <div className="tile"><div className="k">Revenue from headcount alone</div><div className="v">{factor(off(byEmp))}</div><div className="r">{byEmp.length} with PPP jobs · {bias(byEmp)}</div></div>
            <div className="tile"><div className="k">Revenue from PPP payroll alone</div><div className="v">{factor(off(byPay))}</div><div className="r">{byPay.length} with PPP payroll · {bias(byPay)}</div></div>
          </div>
          <table>
            <thead><tr><th>Business</th><th className="num">Revenue (est / actual)</th><th className="num">EBITDA (est / actual)</th><th>Sale (multiple: actual / ours)</th><th>Shown</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => {
                const rr = ratio(r.est_revenue_mid, r.revenue), er = ratio(r.est_ebitda_mid, r.ebitda);
                return (
                  <tr key={r.id}>
                    <td><a href={`/business/${r.id}`}>{r.name}</a><div className="disclaimer" style={{ margin: 0 }}>{r.city}{r.year ? ` · ${r.year}` : ""}{r.note ? ` · ${r.note}` : ""}</div></td>
                    <td className="num">{r.is_public ? "—" : money(r.est_revenue_mid)} / {money(r.revenue)}{rr && !r.is_public ? <div className="disclaimer" style={{ margin: 0 }}>{rr.toFixed(2)}×</div> : null}</td>
                    <td className="num">{r.is_public ? "—" : money(r.est_ebitda_mid)} / {money(r.ebitda)}{er && !r.is_public ? <div className="disclaimer" style={{ margin: 0 }}>{er.toFixed(2)}×</div> : null}</td>
                    <td>{r.sale_price ? <>{money(r.sale_price)}{r.sale_year ? ` (${r.sale_year})` : ""}
                      <div className="disclaimer" style={{ margin: 0 }}>{r.ebitda && Number(r.ebitda) > 0 ? `${(Number(r.sale_price) / Number(r.ebitda)).toFixed(1)}×` : "—"} / {
                        estimateValue({ naics: r.naics, est_ebitda_mid: r.ebitda, is_nonprofit: r.is_nonprofit })?.multiple ?? "—"}×</div></> : "—"}</td>
                    <td>{r.is_public ? "Public" : "Private"}</td>
                    <td><form action={remove}><input type="hidden" name="id" value={r.id} /><button className="link-btn">Remove</button></form></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
