import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { isAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Removal requests | Admin | SeeBITDA", robots: { index: false, follow: false } };

async function guard() {
  if (!(await isAdmin())) redirect("/admin");
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

type Request = { id: string; business_id: string | null; business: string | null; kind: string; name: string | null; email: string; message: string | null; created_at: Date };

export default async function Contacts() {
  await guard();
  const [requests, hidden] = await Promise.all([
    sql<Request[]>`select r.id, b.id as business_id, b.name as business, r.kind, r.name, r.email, r.message, r.created_at
                   from contact_requests r left join businesses b on b.biz_key = r.biz_key
                   where r.status = 'open' order by r.created_at`.catch(() => [] as Request[]),
    sql<{ biz_key: string; id: string; name: string }[]>`select o.biz_key, b.id, b.name from contact_optouts o
                   join businesses b on b.biz_key = o.biz_key order by o.created_at desc`.catch(() => []),
  ]);
  return (
    <main className="page admin">
      <div className="admin-head">
        <h1>Removal &amp; correction requests</h1>
        <div className="admin-nav"><a href="/admin">Verified figures</a></div>
      </div>

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
