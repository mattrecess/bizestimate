import { NextRequest, NextResponse } from "next/server";
import { getContact } from "@/lib/contact";
import { sql } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { PRO_PRICE, reveal } from "@/lib/reveals";

// Contact details load only when someone clicks "Show contact", never with the page, so they aren't
// in the HTML that crawlers read. A per-visitor limit (per server instance) slows bulk harvesting.
const WINDOW_MS = 10 * 60 * 1000;
const LIMIT = 40;
const seen = new Map<string, number[]>();

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const now = Date.now();
  const recent = (seen.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= LIMIT) {
    return NextResponse.json({ error: "Too many requests. Try again in a few minutes." }, { status: 429 });
  }
  recent.push(now);
  seen.set(ip, recent);
  if (seen.size > 50_000) seen.clear();

  // Signed-in users only, a set number of businesses a month (lib/reveals.ts); the admin sees everything.
  const id = (await params).id;
  const [user, admin] = await Promise.all([currentUser(), isAdmin()]);
  if (!user && !admin) return NextResponse.json({ error: "Sign in to see contact info.", signIn: true }, { status: 401 });
  const contact = await getContact(id);
  if (!contact) return NextResponse.json({ error: "not found" }, { status: 404 });
  let allowance = null;
  if (user && !admin) {
    const [b] = await sql`select biz_key from businesses where id = ${id}`;
    allowance = await reveal(user, b.biz_key);
    if (!allowance.ok) {
      return NextResponse.json({ error: "You've used this month's free contact lookups.", upgrade: true, price: PRO_PRICE, ...allowance },
        { status: 402, headers: { "Cache-Control": "private, no-store" } });
    }
  }
  return NextResponse.json({ ...contact, allowance }, { headers: { "Cache-Control": "private, no-store" } });
}
