import { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { isAdmin } from "@/lib/admin";
import { parseFilters, where } from "@/lib/queries";

const MAX_ROWS = 5000;
const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// A mailing list for letters: owner (or "Owner") and the business's address. Your pipeline
// (?pipeline=1, optionally &status=talking) or any search's filters. Signed-in admin only.
export async function GET(req: NextRequest) {
  if (!(await isAdmin())) return new Response("Sign in at /admin first.", { status: 401 });
  const p = req.nextUrl.searchParams;
  const status = p.get("status");
  const scope = p.get("pipeline") === "1"
    ? sql`biz_key in (select biz_key from pipeline ${status ? sql`where status = ${status}` : sql``})`
    : where(parseFilters(p));
  const rows = await sql`
    select name, owner_name, owner_title, address, city, state, zip from businesses
    where ${scope} and not is_individual and coalesce(address, '') <> '' and coalesce(est_method, '') <> 'branch'
    order by est_revenue_mid desc nulls last limit ${MAX_ROWS}`;
  const head = ["Recipient", "Title", "Company", "Address", "City", "State", "ZIP"];
  const lines = rows.map((r) => [r.owner_name || "Owner", r.owner_name ? r.owner_title : "", r.name, r.address, r.city, r.state, r.zip].map(cell).join(","));
  return new Response([head.join(","), ...lines].join("\n") + "\n", {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="mailing-list.csv"', "Cache-Control": "private, no-store" },
  });
}
