import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { extrasFor } from "@/lib/extras";

// The table view's extra columns for the rows on screen (?ids=1,2,3; at most 200). Signed-in users only;
// email and phone for Pro users (and the admin), phones only after the contact-use terms were accepted.
export async function GET(req: NextRequest) {
  const [user, admin] = await Promise.all([currentUser(), isAdmin()]);
  if (!user && !admin) return NextResponse.json({ error: "Sign in to see the table." }, { status: 401 });
  const ids = (req.nextUrl.searchParams.get("ids") ?? "").split(",").filter((x) => /^\d+$/.test(x)).slice(0, 200).map(Number);
  const pro = admin || user?.plan === "pro";
  const contacts = pro ? { phones: admin || !!user?.contact_terms_at } : null;
  try {
    return NextResponse.json({ pro, extras: await extrasFor(ids, contacts) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("extras failed", e);
    return NextResponse.json({ error: "Couldn't load these columns." }, { status: 500 });
  }
}
