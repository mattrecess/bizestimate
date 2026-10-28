import { createHash, randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { authConfigured, safeNext } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Step 1 of Sign in with Google: send the visitor to Google with a one-time state and PKCE challenge,
// both kept in a short-lived cookie that the callback checks.
export async function GET(req: NextRequest) {
  if (!authConfigured()) return NextResponse.json({ error: "Sign-in isn't set up yet" }, { status: 503 });
  const state = randomBytes(16).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${req.nextUrl.origin}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  const res = NextResponse.redirect(url);
  res.cookies.set("bizestimate_oauth", JSON.stringify({ state, verifier, next }), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/auth", maxAge: 600,
  });
  return res;
}
