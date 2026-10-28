import { NextRequest, NextResponse } from "next/server";
import { startSession } from "@/lib/auth";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

type Claims = { iss: string; aud: string; sub: string; exp: number; email?: string; email_verified?: boolean; name?: string; picture?: string };

// Step 2: Google sends the visitor back with a code. Check the state, swap the code for an ID token
// (straight from Google's token endpoint over TLS, so its claims can be read without re-verifying the
// signature), then create or update the account and start a session.
export async function GET(req: NextRequest) {
  const fail = (why: string) => NextResponse.redirect(new URL(`/signin-error?reason=${encodeURIComponent(why)}`, req.nextUrl.origin));
  let saved: { state: string; verifier: string; next: string };
  try { saved = JSON.parse(req.cookies.get("bizestimate_oauth")?.value ?? ""); } catch { return fail("expired"); }
  const p = req.nextUrl.searchParams;
  if (p.get("error")) return fail("cancelled");
  if (!p.get("code") || p.get("state") !== saved.state) return fail("expired");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: p.get("code")!, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${req.nextUrl.origin}/api/auth/google/callback`, grant_type: "authorization_code", code_verifier: saved.verifier,
    }),
  });
  if (!tokenRes.ok) return fail("google");
  const { id_token } = await tokenRes.json() as { id_token?: string };
  let c: Claims;
  try { c = JSON.parse(Buffer.from((id_token ?? "").split(".")[1], "base64url").toString()); } catch { return fail("google"); }
  if (!["accounts.google.com", "https://accounts.google.com"].includes(c.iss) || c.aud !== process.env.GOOGLE_CLIENT_ID
      || c.exp < Date.now() / 1000 || !c.email || !c.email_verified) return fail("google");

  const [u] = await sql<{ id: number }[]>`
    insert into users (google_sub, email, name, picture) values (${c.sub}, ${c.email}, ${c.name ?? null}, ${c.picture ?? null})
    on conflict (google_sub) do update set email = excluded.email, name = excluded.name, picture = excluded.picture, last_sign_in = now()
    returning id`;
  await startSession(u.id);
  const res = NextResponse.redirect(new URL(saved.next, req.nextUrl.origin));
  res.cookies.delete({ name: "bizestimate_oauth", path: "/api/auth" });
  return res;
}
