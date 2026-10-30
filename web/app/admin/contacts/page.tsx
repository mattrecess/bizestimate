import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { businessId, isAdmin } from "@/lib/admin";
import { contactsOf, lookupPerson, refreshPerson, rocketReachConfigured } from "@/lib/rocketreach";

export const dynamic = "force-dynamic";
export const maxDuration = 60;   // a lookup waits up to 20s for RocketReach to finish
export const metadata = { title: "Contacts | Admin | SeeBITDA", robots: { index: false, follow: false } };

const PROVIDER = "rocketreach";
const company = (name: string) => name.replace(/,?\s+(LLC|L\.L\.C\.|INC\.?|CORP\.?|CO\.?|PLLC|LTD\.?)$/i, "");

async function guard() {
  if (!(await isAdmin())) redirect("/admin");
}

async function lookup(form: FormData) {
  "use server";
  await guard();
  const id = businessId(String(form.get("business") ?? ""));
  const [b] = id ? await sql`select biz_key, name, to_jsonb(businesses) ->> 'owner_name' as owner_name from businesses where id = ${id}` : [];
  if (!b) redirect("/admin/contacts?error=business");
  const person = String(form.get("person") ?? "").trim() || b.owner_name;
  if (!person) redirect(`/admin/contacts?error=person&business=${id}`);
  // Each person is looked up once; the saved result is reused (and refreshed for free).
  const [done] = await sql`select status from contact_lookups where biz_key = ${b.biz_key} and provider = ${PROVIDER} and person_name = ${person}`;
  if (done && done.status === "complete") redirect("/admin/contacts?cached=1");
  let error = "";
  try {
    const p = await lookupPerson(person, company(b.name));
    await sql`
      insert into contact_lookups (biz_key, provider, person_name, provider_id, status, data)
      values (${b.biz_key}, ${PROVIDER}, ${person}, ${p.id != null ? String(p.id) : null}, ${String(p.status ?? "")}, ${sql.json(p as never)})
      on conflict (biz_key, provider, person_name) do update set provider_id = excluded.provider_id,
        status = excluded.status, data = excluded.data, updated_at = now()`;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  revalidatePath("/admin/contacts");
  redirect(error ? `/admin/contacts?failed=${encodeURIComponent(error.slice(0, 300))}` : "/admin/contacts");
}

async function refresh(form: FormData) {
  "use server";
  await guard();
  const [row] = await sql`select id, provider_id from contact_lookups where id = ${String(form.get("id"))}`;
  if (row?.provider_id) {
    const p = await refreshPerson(row.provider_id).catch(() => null);
    if (p) await sql`update contact_lookups set status = ${String(p.status ?? "")}, data = ${sql.json(p as never)}, updated_at = now() where id = ${row.id}`;
  }
  redirect("/admin/contacts");
}

async function forget(form: FormData) {
  "use server";
  await guard();
  await sql`delete from contact_lookups where id = ${String(form.get("id"))}`;
  redirect("/admin/contacts");
}

async function resolve(form: FormData) {
  "use server";
  await guard();
  const id = String(form.get("id"));
  const action = String(form.get("action"));
  if (action === "hide") {
    await sql`insert into contact_optouts (biz_key) select biz_key from contact_requests where id = ${id} and biz_key is not null
              on conflict do nothing`;
  }
  await sql`update contact_requests set status = ${action === "dismiss" ? "dismissed" : "done"} where id = ${id}`;
  redirect("/admin/contacts");
}

async function unhide(form: FormData) {
  "use server";
  await guard();
  await sql`delete from contact_optouts where biz_key = ${String(form.get("biz_key"))}`;
  redirect("/admin/contacts");
}

type Lookup = { id: string; business_id: string; name: string; person_name: string; status: string; data: Record<string, unknown>; updated_at: Date };
type Request = { id: string; business_id: string | null; business: string | null; kind: string; name: string | null; email: string; message: string | null; created_at: Date };

export default async function Contacts({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await guard();
  const params = await searchParams;
  const [lookups, requests, hidden] = await Promise.all([
    sql<Lookup[]>`select l.id, b.id as business_id, b.name, l.person_name, l.status, l.data, l.updated_at
                  from contact_lookups l join businesses b on b.biz_key = l.biz_key order by l.updated_at desc limit 200`.catch(() => [] as Lookup[]),
    sql<Request[]>`select r.id, b.id as business_id, b.name as business, r.kind, r.name, r.email, r.message, r.created_at
                   from contact_requests r left join businesses b on b.biz_key = r.biz_key
                   where r.status = 'open' order by r.created_at`.catch(() => [] as Request[]),
    sql<{ biz_key: string; id: string; name: string }[]>`select o.biz_key, b.id, b.name from contact_optouts o
                   join businesses b on b.biz_key = o.biz_key order by o.created_at desc`.catch(() => []),
  ]);
  return (
    <main className="page admin">
      <div className="admin-head">
        <h1>Contacts</h1>
        <div className="admin-nav"><a href="/admin">Verified figures</a></div>
      </div>

      <h2>Owner lookup (RocketReach)</h2>
      <p className="disclaimer">Private to you: RocketReach licenses its data for your own use, so these results never
        appear on public pages. A lookup uses one RocketReach credit; each person is looked up once and saved.</p>
      {!rocketReachConfigured() ? (
        <p>Add a <code>ROCKETREACH_API_KEY</code> environment variable in Vercel (RocketReach → Account → API) to turn this on.</p>
      ) : (
        <form action={lookup} className="admin-form">
          <input name="business" placeholder="Business link or number (…/business/1316278)" defaultValue={params.business ?? ""} required />
          <input name="person" placeholder="Person (defaults to the owner on file)" />
          <button className="btn primary">Look up</button>
        </form>
      )}
      {params.error === "business" && <p className="badge warn">Couldn&apos;t find that business. Paste its page link or number.</p>}
      {params.error === "person" && <p className="badge warn">No owner on file for that business. Enter the person&apos;s name.</p>}
      {params.cached && <p className="badge good">Already looked up; showing the saved result.</p>}
      {params.failed && <p className="badge warn">{params.failed}</p>}
      {lookups.length > 0 && (
        <table>
          <thead><tr><th>Person</th><th>Email</th><th>Phone</th><th>Status</th><th /></tr></thead>
          <tbody>
            {lookups.map((l) => {
              const { emails, phones } = contactsOf(l.data);
              return (
                <tr key={l.id}>
                  <td>{l.person_name}<div className="disclaimer" style={{ margin: 0 }}><a href={`/business/${l.business_id}`}>{l.name}</a></div></td>
                  <td>{emails.length ? <ul>{emails.map((e) => <li key={e.value}><a href={`mailto:${e.value}`}>{e.value}</a>{e.type ? ` (${e.type})` : ""}</li>)}</ul> : "—"}</td>
                  <td>{phones.length ? <ul>{phones.map((p) => <li key={p.value}><a href={`tel:${p.value.replace(/[^\d+]/g, "")}`}>{p.value}</a>{p.type ? ` (${p.type})` : ""}</li>)}</ul> : "—"}</td>
                  <td>{l.status || "—"}</td>
                  <td>
                    {l.status !== "complete" && <form action={refresh}><input type="hidden" name="id" value={l.id} /><button className="link-btn">Refresh</button></form>}
                    <form action={forget}><input type="hidden" name="id" value={l.id} /><button className="link-btn">Delete</button></form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h2>Removal &amp; correction requests</h2>
      {requests.length === 0 ? <p className="disclaimer">No open requests.</p> : (
        <table>
          <thead><tr><th>Business</th><th>Request</th><th>From</th><th /></tr></thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id}>
                <td>{r.business_id ? <a href={`/business/${r.business_id}`}>{r.business}</a> : "—"}
                  <div className="disclaimer" style={{ margin: 0 }}>{new Date(r.created_at).toLocaleDateString()}</div></td>
                <td><b>{r.kind}</b>{r.message && <div>{r.message}</div>}</td>
                <td>{r.name}<div><a href={`mailto:${r.email}`}>{r.email}</a></div></td>
                <td>
                  {(["hide", "done", "dismiss"] as const).map((a) => (r.business_id || a !== "hide") && (
                    <form key={a} action={resolve}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="action" value={a} />
                      <button className="link-btn">{a === "hide" ? "Hide contact" : a === "done" ? "Mark done" : "Dismiss"}</button></form>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {hidden.length > 0 && (
        <>
          <h2>Contact hidden</h2>
          <table><tbody>
            {hidden.map((h) => (
              <tr key={h.biz_key}><td><a href={`/business/${h.id}`}>{h.name}</a></td>
                <td><form action={unhide}><input type="hidden" name="biz_key" value={h.biz_key} /><button className="link-btn">Show again</button></form></td></tr>
            ))}
          </tbody></table>
        </>
      )}
    </main>
  );
}
