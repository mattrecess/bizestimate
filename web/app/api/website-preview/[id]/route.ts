import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

// Can this business's own website be shown inside our page (the website preview)? Many sites forbid it
// (X-Frame-Options or a Content-Security-Policy frame-ancestors rule); then the button just opens a new
// tab. Only the website on file for the business is checked, never an address from the request.
const TIMEOUT_MS = 6000;

function allowsFraming(headers: Headers) {
  const xfo = (headers.get("x-frame-options") ?? "").toLowerCase();
  if (xfo.includes("deny") || xfo.includes("sameorigin")) return false;
  const csp = headers.get("content-security-policy") ?? "";
  const rule = csp.split(";").map((d) => d.trim().toLowerCase()).find((d) => d.startsWith("frame-ancestors"));
  if (rule) {
    const sources = rule.split(/\s+/).slice(1);
    if (!sources.some((s) => s === "*" || s.includes("seebitda.com"))) return false;
  }
  return true;
}

async function check(url: string) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: "follow", signal: ctrl.signal, headers: { "User-Agent": "SeeBITDA website preview" } });
    res.body?.cancel().catch(() => {});
    const final = res.url || url;
    // Our pages are https: a site that ends up on plain http would be blocked by the browser anyway.
    return { ok: res.ok && final.startsWith("https://") && allowsFraming(res.headers), url: final };
  } catch {
    return { ok: false, url };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  if (!/^\d+$/.test(id)) return NextResponse.json({ ok: false }, { status: 404 });
  const [b] = await sql`select to_jsonb(b) ->> 'website' as website from businesses b where id = ${id}`;
  const site = (b?.website ?? "").trim();
  if (!/^https?:\/\/[^/\s]+\.[a-z]{2,}/i.test(site)) return NextResponse.json({ ok: false, url: site || null });
  const https = site.replace(/^http:\/\//i, "https://");   // try the secure address first
  const result = await check(https);
  return NextResponse.json(result, { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } });
}
