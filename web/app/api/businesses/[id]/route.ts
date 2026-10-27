import { NextResponse } from "next/server";
import { getProfile, getProfileCore } from "@/lib/business";
import { CACHE } from "@/lib/queries";

// ?core=1: the business and its own records only (fast); the side panel loads /related after.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const core = new URL(req.url).searchParams.get("core") === "1";
  const profile = core ? await getProfileCore(id) : await getProfile(id);
  if (!profile) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(profile, { headers: { "Cache-Control": CACHE } });
}
