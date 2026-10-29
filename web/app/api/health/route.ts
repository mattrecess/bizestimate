import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// For the uptime monitor: never cached, so every check reaches the server and the database (keeping
// both awake) and a database outage shows up as down.
export async function GET() {
  const t0 = Date.now();
  try {
    await sql`select id from businesses limit 1`;
    return NextResponse.json({ ok: true, db_ms: Date.now() - t0 }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
