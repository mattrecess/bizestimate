import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  const email = String(b?.contact_email ?? "").trim();
  const name = String(b?.contact_name ?? "").trim();
  if (!b || !/^\d+$/.test(String(b.business_id)) || !name || !/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ error: "business_id, contact_name and a valid contact_email are required" }, { status: 400 });
  }
  const n = (v: unknown) => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  await sql`
    insert into claims (business_id, contact_name, contact_email, message, reported_revenue, reported_ebitda, request_removal)
    values (${b.business_id}, ${name.slice(0, 200)}, ${email.slice(0, 200)}, ${String(b.message ?? "").slice(0, 2000)},
            ${n(b.reported_revenue)}, ${n(b.reported_ebitda)}, ${Boolean(b.request_removal)})`;
  return NextResponse.json({ ok: true });
}
