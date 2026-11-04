import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { getProfile, getProfileCore } from "@/lib/business";

// A business for the map's side panel. ?core=1: the business and its own records only (fast); the side panel
// loads /related after. Kept in the server's data cache under the tags biz-<id> and profiles, which are cleared
// when a search on its page saves something (owner, executives) or a data load finishes, so what one visitor
// finds shows for everyone at once. Browsers don't keep it.
const cached = (id: string, core: boolean) => unstable_cache(
  () => (core ? getProfileCore(id) : getProfile(id)), ["profile", id, core ? "core" : "full"],
  { revalidate: 86400, tags: [`biz-${id}`, "profiles"] })();

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const core = new URL(req.url).searchParams.get("core") === "1";
  const profile = await cached(id, core);
  if (!profile) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(profile, { headers: { "Cache-Control": "no-store" } });
}
