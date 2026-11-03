import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { tables } from "@/lib/reveals";

// "Notify me when Pro opens": until billing is built, the people who want Pro (Admin → Users).
export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  await tables();
  await sql`insert into pro_interest (user_id) values (${user.id}) on conflict do nothing`;
  return NextResponse.json({ ok: true });
}
