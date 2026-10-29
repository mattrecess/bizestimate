import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { isAdmin } from "@/lib/admin";
import { money } from "@/lib/format";
import { INDUSTRIES } from "@/lib/industries";
import { estimateValue } from "@/lib/valuation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Industry figures | Admin | BizEstimate", robots: { index: false, follow: false } };

type Override = { naics_prefix: string; revenue_per_employee: string | null; ebitda_margin: string | null; multiple: string | null;
  note: string | null; updated_at: string; label: string | null; bench_rpe: string | null; businesses: number };
type Learned = { naics_prefix: string; segment: string; revenue_factor: string; n: number; typical_miss: string | null; label: string | null };

async function guard() {
  if (!(await isAdmin())) redirect("/admin");
}

// "250k", "$1.2M", "250,000" -> dollars; "12%", "0.12", "12" -> 0.12.
function dollars(v: FormDataEntryValue | null) {
  const m = String(v ?? "").toLowerCase().replace(/[$,\s]/g, "").match(/^(\d+(?:\.\d+)?)(k|m)?$/);
  return m ? Math.round(Number(m[1]) * (m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : 1)) : null;
}
function share(v: FormDataEntryValue | null) {
  const n = Number(String(v ?? "").replace(/[%\s]/g, ""));
  return String(v ?? "").trim() && Number.isFinite(n) && n > 0 ? (n > 1 ? n / 100 : n) : null;
}

async function save(form: FormData) {
  "use server";
  await guard();
  const prefix = String(form.get("naics") ?? "").trim();
  if (!/^\d{2,6}$/.test(prefix)) redirect("/admin/industries?error=naics");
  const rpe = dollars(form.get("rpe"));
  const margin = share(form.get("margin"));
  const multiple = Number(String(form.get("multiple") ?? "").replace(/[x×\s]/gi, "")) || null;
  if (!rpe && !margin && !multiple) redirect("/admin/industries?error=empty");
  await sql`insert into industry_overrides (naics_prefix, revenue_per_employee, ebitda_margin, multiple, note, updated_at)
    values (${prefix}, ${rpe}, ${margin}, ${multiple}, ${String(form.get("note") ?? "").trim() || null}, now())
    on conflict (naics_prefix) do update set revenue_per_employee = excluded.revenue_per_employee,
      ebitda_margin = excluded.ebitda_margin, multiple = excluded.multiple, note = excluded.note, updated_at = now()`;
  revalidatePath("/admin/industries");
  redirect("/admin/industries?saved=1");
}

async function saveGrowth(form: FormData) {
  "use server";
  await guard();
  const g = share(form.get("growth"));
  if (g === null || g > 0.5) redirect("/admin/industries?error=growth");
  await sql`insert into estimate_settings (key, value, updated_at) values ('annual_growth', ${g}, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()`;
  revalidatePath("/admin/industries");
  redirect("/admin/industries?saved=1");
}

async function saveTilt(form: FormData) {
  "use server";
  await guard();
  const t = share(form.get("tilt"));
  const v = String(form.get("tilt") ?? "").trim() === "0" || String(form.get("tilt") ?? "").trim() === "0%" ? 0 : t;
  if (v === null || v > 1) redirect("/admin/industries?error=tilt");
  await sql`insert into estimate_settings (key, value, updated_at) values ('range_tilt', ${v}, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()`;
  revalidatePath("/admin/industries");
  redirect("/admin/industries?saved=1");
}

async function remove(form: FormData) {
  "use server";
  await guard();
  await sql`delete from industry_overrides where naics_prefix = ${String(form.get("naics") ?? "")}`;
  revalidatePath("/admin/industries");
}

const labelOf = (code: string) => INDUSTRIES.find((i) => i.naics.some((c) => c === code || code.startsWith(c)))?.label ?? null;

export default async function Industries({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await guard();
  const p = await searchParams;
  const overrides = await sql<Override[]>`
    select o.naics_prefix, o.revenue_per_employee, o.ebitda_margin, o.multiple, o.note, o.updated_at::date::text,
           (select label from industry_benchmarks where o.naics_prefix like naics_prefix || '%' order by length(naics_prefix) desc limit 1) as label,
           (select revenue_per_employee from industry_benchmarks where o.naics_prefix like naics_prefix || '%' order by length(naics_prefix) desc limit 1) as bench_rpe,
           (select count(*)::int from businesses where naics like o.naics_prefix || '%') as businesses
    from industry_overrides o order by o.naics_prefix`.catch(() => [] as Override[]);
  const [growthRow] = await sql<{ value: string }[]>`select value from estimate_settings where key = 'annual_growth'`.catch(() => []);
  const growth = growthRow ? Number(growthRow.value) : 0.08;
  const [tiltRow] = await sql<{ value: string }[]>`select value from estimate_settings where key = 'range_tilt'`.catch(() => []);
  const tilt = tiltRow ? Number(tiltRow.value) : 0.5;
  const learned = await sql<Learned[]>`
    select c.naics_prefix, c.segment, c.revenue_factor, c.n, c.typical_miss,
           (select label from industry_benchmarks where c.naics_prefix like naics_prefix || '%' order by length(naics_prefix) desc limit 1) as label
    from industry_calibration c order by c.segment, c.n desc`.catch(() => [] as Learned[]);
  return (
    <main className="page admin">
      <div className="admin-head">
        <h1>Industry figures</h1>
        <div className="admin-nav"><a href="/admin">Verified figures</a><a href="/admin/corrections">Owner corrections</a><a href="/admin/pipeline">My pipeline</a></div>
      </div>
      {p.saved && <p className="badge good">Saved. It takes effect on the next data load.</p>}
      {p.error === "naics" && <p className="badge warn">Enter a NAICS code of 2 to 6 digits.</p>}
      {p.error === "empty" && <p className="badge warn">Enter at least one figure.</p>}
      {p.error === "growth" && <p className="badge warn">Enter a growth rate between 0% and 50%.</p>}
      {p.error === "tilt" && <p className="badge warn">Enter a tilt between 0% (middle) and 100% (top of the range).</p>}
      <h2>Growth since 2020</h2>
      <p className="disclaimer">Estimates built from 2020 PPP figures (headcount, payroll, and the industry averages drawn from them)
        are brought up to today at this rate a year, in place of inflation and Oklahoma job growth. Currently{" "}
        <b>{(growth * 100).toFixed(1).replace(/\.0$/, "")}%</b>. Calibration below measures the result against real figures each load.</p>
      <form action={saveGrowth} className="admin-form">
        <input name="growth" placeholder="Annual growth (e.g. 8%)" defaultValue={`${(growth * 100).toFixed(1).replace(/\.0$/, "")}%`} />
        <button className="btn primary">Save growth rate</button>
      </form>
      <h2>Tilt toward the top of the range</h2>
      <p className="disclaimer">How far up its range each estimate is shown: 0% is the middle, 100% the top of the range. Currently{" "}
        <b>{Math.round(tilt * 100)}%</b> (with a typical range of 0.7×–1.4×, 50% shows about 18% above the middle). Applies to
        every estimate with a range (not reported or verified figures); calibration keeps measuring the untilted figures.</p>
      <form action={saveTilt} className="admin-form">
        <input name="tilt" placeholder="Tilt (e.g. 50%)" defaultValue={`${Math.round(tilt * 100)}%`} />
        <button className="btn primary">Save tilt</button>
      </form>
      <h2>Your industry figures</h2>
      <p className="disclaimer">Your own figures for an industry, by NAICS code (2–6 digits; a longer code is more specific, e.g.
        23 construction, 2382 building equipment contractors, 238220 plumbing &amp; HVAC). They replace ours on the next data load
        (overnight): revenue per employee scales every estimate in the industry, EBITDA margin replaces ours, and the multiple is
        for a typical company with about $1M of EBITDA (smaller and larger ones still scale with size). Leave a field empty to keep ours.</p>
      <form action={save} className="admin-form">
        <input name="naics" placeholder="NAICS code (e.g. 238220)" required inputMode="numeric" />
        <input name="rpe" placeholder="Revenue per employee (e.g. 180k)" />
        <input name="margin" placeholder="EBITDA margin (e.g. 12%)" />
        <input name="multiple" placeholder="Multiple at ~$1M EBITDA (e.g. 4.5)" />
        <input name="note" placeholder="Source / note (private)" />
        <button className="btn primary">Save</button>
      </form>
      {overrides.length > 0 && (
        <table>
          <thead><tr><th>Industry</th><th className="num">Revenue / employee (yours, today vs Census, survey year)</th><th className="num">EBITDA margin</th><th className="num">Multiple</th><th /></tr></thead>
          <tbody>
            {overrides.map((o) => (
              <tr key={o.naics_prefix}>
                <td><b>{o.naics_prefix}</b> {labelOf(o.naics_prefix) ?? o.label}<div className="disclaimer" style={{ margin: 0 }}>
                  {o.businesses.toLocaleString()} businesses · {o.updated_at}{o.note ? ` · ${o.note}` : ""}</div></td>
                <td className="num">{o.revenue_per_employee ? money(o.revenue_per_employee) : "—"} / {money(o.bench_rpe)}</td>
                <td className="num">{o.ebitda_margin ? `${(Number(o.ebitda_margin) * 100).toFixed(1)}%` : "—"}</td>
                <td className="num">{o.multiple ? `${Number(o.multiple).toFixed(1)}×` : "—"}<div className="disclaimer" style={{ margin: 0 }}>
                  ours {estimateValue({ naics: o.naics_prefix, est_ebitda_mid: 1e6 })?.multiple ?? "—"}×</div></td>
                <td><form action={remove}><input type="hidden" name="naics" value={o.naics_prefix} /><button className="link-btn">Remove</button></form></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Learned from real figures</h2>
      <p className="disclaimer">Recomputed every data load from businesses whose revenue we know (Form 990, SEC filings, figures you
        entered, owner corrections), comparing it with what our method alone would have estimated. A factor below 1 means we were
        too high. Used only where you haven&apos;t set your own revenue per employee, and nonprofit figures only ever adjust nonprofits.</p>
      {!learned.length ? <p>None yet: an industry needs 20 known businesses in a segment.</p> : (
        <table>
          <thead><tr><th>Industry</th><th>Segment</th><th className="num">Factor</th><th className="num">Known businesses</th><th className="num">Raw estimate typically off</th></tr></thead>
          <tbody>
            {learned.map((l) => (
              <tr key={`${l.naics_prefix}-${l.segment}`}>
                <td><b>{l.naics_prefix}</b> {labelOf(l.naics_prefix) ?? l.label}</td>
                <td>{l.segment === "nonprofit" ? "Nonprofits" : "Companies"}</td>
                <td className="num">×{Number(l.revenue_factor).toFixed(2)}</td>
                <td className="num">{l.n.toLocaleString()}</td>
                <td className="num">{l.typical_miss ? `${Number(l.typical_miss).toFixed(2)}×` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
