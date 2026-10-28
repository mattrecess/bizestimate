import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

// The admin area is one password (ADMIN_PASSWORD, set in Vercel). Signing in stores a signed token
// in an httpOnly cookie; nothing else about the session is kept.
const COOKIE = "bizestimate_admin";

function token(password: string) {
  return createHmac("sha256", password).update("bizestimate-admin-v1").digest("hex");
}

export function adminConfigured() {
  return !!process.env.ADMIN_PASSWORD;
}

export async function isAdmin() {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return false;
  const got = (await cookies()).get(COOKIE)?.value ?? "";
  const want = token(password);
  return got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

export async function signIn(attempt: string) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return false;
  const a = Buffer.from(attempt), b = Buffer.from(password);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  (await cookies()).set(COOKIE, token(password), {
    // Whole site, so business pages can show your pipeline tools (fetched from /api/admin/..., never cached).
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30,
  });
  return true;
}

export async function signOut() {
  const jar = await cookies();
  jar.delete({ name: COOKIE, path: "/" });
  jar.delete({ name: COOKIE, path: "/admin" });   // from before the cookie covered the whole site
}

// "https://.../business/1316278", "?id=1316278" or "1316278" -> "1316278".
export function businessId(input: string) {
  const s = input.trim();
  return s.match(/\/business\/(\d+)/)?.[1] ?? s.match(/[?&]id=(\d+)/)?.[1] ?? s.match(/^(\d+)$/)?.[1] ?? null;
}
