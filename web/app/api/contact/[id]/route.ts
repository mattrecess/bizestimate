import { NextRequest, NextResponse } from "next/server";
import { getContact } from "@/lib/contact";

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

  const contact = await getContact((await params).id);
  if (!contact) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(contact, { headers: { "Cache-Control": "private, no-store" } });
}
