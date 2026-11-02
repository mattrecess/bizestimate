import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentUser } from "@/lib/auth";

// A Pro user accepting the contact-use terms (shown before owners' phone numbers are revealed).
export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  await sql`update users set contact_terms_at = now() where id = ${user.id} and contact_terms_at is null`;
  return NextResponse.json({ ok: true });
}
