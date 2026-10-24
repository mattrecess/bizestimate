import { NextResponse } from "next/server";
import { getProfile } from "@/lib/business";
import { CACHE } from "@/lib/queries";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getProfile((await params).id);
  if (!profile) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(profile, { headers: { "Cache-Control": CACHE } });
}
