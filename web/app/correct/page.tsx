import Link from "next/link";
import { redirect } from "next/navigation";
import Footer from "@/components/Footer";
import { sql } from "@/lib/db";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Correct a business's figures | SeeBITDA", robots: { index: false, follow: false } };

const RELATIONSHIPS = { owner: "I own it", executive: "I'm an executive or manager there", advisor: "I'm its accountant or advisor", other: "Other" };

// "$4.2M", "4,200,000", "4.2 million", "850k" -> dollars.
function dollars(v: string) {
  const s = v.toLowerCase().replace(/[$,\s]/g, "");
  const m = s.match(/^(\d+(?:\.\d+)?)(k|m|mm|million|b|billion)?$/);
  if (!m) return null;
  const mult = { k: 1e3, m: 1e6, mm: 1e6, million: 1e6, b: 1e9, billion: 1e9 }[m[2] as "k"] ?? 1;
  return Math.round(Number(m[1]) * mult);
}

async function submit(form: FormData) {
  "use server";
  const text = (k: string, max: number) => String(form.get(k) ?? "").trim().slice(0, max);
  if (text("website", 200)) redirect("/correct?sent=1");   // hidden field: only bots fill it in
  const id = text("business", 20);
  const [b] = /^\d+$/.test(id) ? await sql`select biz_key from businesses where id = ${id}` : [];
  if (!b) redirect("/correct?error=business");
  const email = text("email", 200);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) redirect(`/correct?business=${id}&error=email`);
  const revenue = dollars(text("revenue", 40));
  const ebitda = dollars(text("ebitda", 40));
  const employees = Number(text("employees", 10).replace(/,/g, "")) || null;
  if (!revenue && !ebitda && !employees) redirect(`/correct?business=${id}&error=figures`);
  const rel = text("relationship", 20) in RELATIONSHIPS ? text("relationship", 20) : "other";
  const year = Number(text("year", 4)) || null;
  await sql`insert into estimate_corrections (biz_key, relationship, name, email, revenue, ebitda, employees, year, show_publicly, message)
    values (${b.biz_key}, ${rel}, ${text("name", 200) || null}, ${email}, ${revenue}, ${ebitda}, ${employees}, ${year},
            ${form.get("show_publicly") === "on"}, ${text("message", 4000) || null})`;
  redirect(`/correct?sent=1&business=${id}`);
}

export default async function Correct({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const p = await searchParams;
  const id = /^\d+$/.test(p.business ?? "") ? p.business : "";
  const [b] = id ? await sql`select name, city, est_revenue_mid, est_ebitda_mid, jobs_reported from businesses where id = ${id}`.catch(() => []) : [];
  const lastYear = new Date().getFullYear() - 1;
  return (
    <>
      <main className="page">
        <h1>Correct a business&apos;s figures</h1>
        {p.sent ? (
          <p>Thank you. We&apos;ll review your figures, usually within a few business days, and may email you to confirm.
            {id && <> <Link href={`/business/${id}`}>Back to the business</Link>.</>}</p>
        ) : !b ? (
          <p>Open the business on SeeBITDA and use <b>Correct these figures</b> on its page.</p>
        ) : (
          <>
            <p>For <b>{b.name}</b>{b.city ? ` (${b.city})` : ""}. We currently estimate revenue of about {money(b.est_revenue_mid)} and
              EBITDA of about {money(b.est_ebitda_mid)}.</p>
            <p>If you own or run the business, actual figures help us get it right, and help every estimate in your industry.
              <b> By default we keep your figures private</b>: they only tune our estimates and are never shown. Tick the box
              below if you&apos;d like your page to show them as verified.</p>
            {p.error === "email" && <p className="badge warn">Please enter a valid email address so we can confirm.</p>}
            {p.error === "figures" && <p className="badge warn">Please enter at least one figure: revenue, EBITDA or employees.</p>}
            <form action={submit} className="contact-form">
              <input type="hidden" name="business" value={id} />
              <input name="website" tabIndex={-1} autoComplete="off" style={{ position: "absolute", left: "-9999px" }} aria-hidden />
              <select name="relationship" defaultValue="owner" aria-label="Your connection to the business">
                {Object.entries(RELATIONSHIPS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
              <input name="name" placeholder="Your name" />
              <input name="email" type="email" placeholder="Your work email" required />
              <input name="revenue" placeholder="Annual revenue, e.g. $4.2M" inputMode="decimal" />
              <input name="ebitda" placeholder="EBITDA (optional), e.g. $650k" inputMode="decimal" />
              <input name="employees" placeholder="Employees (optional)" inputMode="numeric" />
              <input name="year" placeholder={`Year these are for, e.g. ${lastYear}`} inputMode="numeric" defaultValue={lastYear} />
              <textarea name="message" rows={3} placeholder="Anything else we should know (optional)" />
              <label className="check"><input type="checkbox" name="show_publicly" /> Show these figures on our page as verified</label>
              <button className="btn primary">Send figures</button>
            </form>
            <p className="disclaimer">Figures are checked by hand before they&apos;re used. An email at the company&apos;s own web
              domain helps us confirm quickly.</p>
          </>
        )}
      </main>
      <Footer />
    </>
  );
}
