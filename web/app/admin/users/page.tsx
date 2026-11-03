import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { isAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Users | Admin | SeeBITDA", robots: { index: false, follow: false } };

type U = { id: string; email: string; name: string | null; plan: string; contact_terms_at: string | null; created_at: string;
  last_sign_in: string; saved: number; lookups: number; wants_pro: boolean };

async function guard() {
  if (!(await isAdmin())) redirect("/admin");
}

// Until Stripe billing sets it, the plan is set here by hand (e.g. for a pilot customer).
async function setPlan(form: FormData) {
  "use server";
  await guard();
  const plan = form.get("plan") === "pro" ? "pro" : "free";
  await sql`update users set plan = ${plan} where id = ${String(form.get("id") ?? "")}`;
  revalidatePath("/admin/users");
}

export default async function Users() {
  await guard();
  await sql`alter table users add column if not exists plan text not null default 'free'`;
  await sql`alter table users add column if not exists contact_terms_at timestamptz`;
  await sql`create table if not exists pro_interest (user_id bigint primary key, created_at timestamptz not null default now())`;
  const users = await sql<U[]>`
    select u.id, u.email, u.name, u.plan, u.contact_terms_at::text, u.created_at::text, u.last_sign_in::text,
      (select count(*)::int from user_saved_businesses s where s.user_id = u.id) as saved,
      (select count(*)::int from owner_contact_reveals r where r.user_id = u.id and r.revealed_at >= date_trunc('month', now())) as lookups,
      exists (select 1 from pro_interest i where i.user_id = u.id) as wants_pro
    from users u order by u.last_sign_in desc limit 500`.catch(async () => sql<U[]>`
    select u.id, u.email, u.name, u.plan, u.contact_terms_at::text, u.created_at::text, u.last_sign_in::text, 0 as saved, 0 as lookups, false as wants_pro
    from users u order by u.last_sign_in desc limit 500`);
  return (
    <main className="page admin">
      <div className="admin-head">
        <h1>Users ({users.length})</h1>
        <div className="admin-nav"><a href="/admin">Verified figures</a></div>
      </div>
      <p className="disclaimer">Everyone who has signed in with Google; &ldquo;wants Pro&rdquo; = asked to be told when Pro opens. Pro unlocks owners&apos; phone numbers (after the user accepts the
        contact-use terms); Stripe billing will set the plan automatically once it&apos;s built.</p>
      {!users.length ? <p>No sign-ins yet.</p> : (
        <table>
          <thead><tr><th>User</th><th>Joined / last seen</th><th className="num">On radar</th><th className="num">Contact lookups this month</th><th>Plan</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name ?? "—"}<div className="disclaimer" style={{ margin: 0 }}>{u.email}</div></td>
                <td>{u.created_at.slice(0, 10)}<div className="disclaimer" style={{ margin: 0 }}>{u.last_sign_in.slice(0, 10)}</div></td>
                <td className="num">{u.saved}</td>
                <td className="num">{u.lookups}</td>
                <td>
                  <b>{u.plan === "pro" ? "Pro" : "Free"}</b>{u.wants_pro && u.plan !== "pro" ? <span className="badge good"> wants Pro</span> : null}{u.plan === "pro" && !u.contact_terms_at ? " · terms not accepted yet" : ""}
                  <form action={setPlan}><input type="hidden" name="id" value={u.id} />
                    <input type="hidden" name="plan" value={u.plan === "pro" ? "free" : "pro"} />
                    <button className="link-btn">{u.plan === "pro" ? "Set to Free" : "Make Pro"}</button></form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
