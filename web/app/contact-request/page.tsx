import Link from "next/link";
import { redirect } from "next/navigation";
import Footer from "@/components/Footer";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Remove or correct contact details | BizEstimate", robots: { index: false, follow: false } };

const KINDS = { remove: "Remove our contact details", correct: "Correct our contact details", other: "Something else" };

async function submit(form: FormData) {
  "use server";
  const text = (k: string, max: number) => String(form.get(k) ?? "").trim().slice(0, max);
  if (text("website", 200)) redirect("/contact-request?sent=1");   // hidden field: only bots fill it in
  const kind = text("kind", 20) in KINDS ? text("kind", 20) : "other";
  const id = text("business", 20);
  const [b] = /^\d+$/.test(id) ? await sql`select biz_key from businesses where id = ${id}` : [];
  const email = text("email", 200);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) redirect(`/contact-request?business=${id}&error=email`);
  await sql`insert into contact_requests (biz_key, kind, name, email, message)
            values (${b?.biz_key ?? null}, ${kind}, ${text("name", 200) || null}, ${email}, ${text("message", 4000) || null})`;
  redirect(`/contact-request?sent=1${b ? `&business=${id}` : ""}`);
}

export default async function ContactRequest({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const params = await searchParams;
  const id = /^\d+$/.test(params.business ?? "") ? params.business : "";
  const [b] = id ? await sql`select name, city from businesses where id = ${id}`.catch(() => []) : [];
  return (
    <>
      <main className="page">
        <h1>Remove or correct contact details</h1>
        {params.sent ? (
          <p>Thanks. We&apos;ve received your request and will review it, usually within a few business days.
            {id && <> <Link href={`/business/${id}`}>Back to the business</Link>.</>}</p>
        ) : (
          <>
            <p>{b ? <>For <b>{b.name}</b>{b.city ? ` (${b.city})` : ""}. </> : null}
              If you own or represent the business, tell us what to change. Requests are checked by hand.</p>
            {params.error && <p className="badge warn">Please enter a valid email address so we can confirm the change.</p>}
            <form action={submit} className="contact-form">
              <input type="hidden" name="business" value={id} />
              <input name="website" tabIndex={-1} autoComplete="off" style={{ position: "absolute", left: "-9999px" }} aria-hidden />
              <select name="kind" defaultValue="remove">
                {Object.entries(KINDS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
              <input name="name" placeholder="Your name" />
              <input name="email" type="email" placeholder="Your email" required />
              <textarea name="message" rows={4} placeholder={b ? "What should change?" : "Business name and city, and what should change"} />
              <button className="btn primary">Send request</button>
            </form>
          </>
        )}
      </main>
      <Footer />
    </>
  );
}
