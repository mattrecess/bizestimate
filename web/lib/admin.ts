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
    httpOnly: true, secure: true, sameSite: "strict", path: "/admin", maxAge: 60 * 60 * 24 * 30,
  });
  return true;
}

export async function signOut() {
  (await cookies()).delete({ name: COOKIE, path: "/admin" });
}
