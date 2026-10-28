import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { sql } from "./db";

// Visitor accounts: Sign in with Google (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET, set in Vercel).
// The session is a signed cookie holding the user id and an expiry; nothing else is stored in it.
const COOKIE = "bizestimate_user";
const DAYS = 90;

export type User = { id: number; email: string; name: string | null; picture: string | null };

export function authConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

const key = () => process.env.AUTH_SECRET || process.env.GOOGLE_CLIENT_SECRET || "";
const sign = (payload: string) => createHmac("sha256", key()).update(`user-v1:${payload}`).digest("hex");

export async function startSession(userId: number) {
  const exp = Math.floor(Date.now() / 1000) + DAYS * 86400;
  const payload = `${userId}.${exp}`;
  (await cookies()).set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: DAYS * 86400,
  });
}

export async function endSession() {
  (await cookies()).delete({ name: COOKIE, path: "/" });
}

async function sessionUserId() {
  if (!key()) return null;
  const [id, exp, sig] = ((await cookies()).get(COOKIE)?.value ?? "").split(".");
  if (!id || !exp || !sig) return null;
  const want = sign(`${id}.${exp}`);
  if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  return Number(id);
}

export async function currentUser(): Promise<User | null> {
  const id = await sessionUserId();
  if (!id) return null;
  const [u] = await sql<User[]>`select id, email, name, picture from users where id = ${id}`;
  return u ?? null;
}

// Where to send the visitor back to after signing in: only a path on this site.
export function safeNext(next: string | null) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}
