import { NextRequest, NextResponse } from "next/server";

// The old Vercel address redirects page views to the real domain, so search engines index one site.
// API calls (crons, monitors, the app itself) are left alone.
const OLD_HOSTS = new Set(["bizestimate-six.vercel.app"]);
const CANONICAL = "www.seebitda.com";

export function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  if (OLD_HOSTS.has(host) && !req.nextUrl.pathname.startsWith("/api/")) {
    const url = new URL(req.nextUrl.pathname + req.nextUrl.search, `https://${CANONICAL}`);
    return NextResponse.redirect(url, 308);
  }
  return NextResponse.next();
}

export const config = { matcher: "/((?!_next/|favicon|icon|maplibre-gl-worker).*)" };
