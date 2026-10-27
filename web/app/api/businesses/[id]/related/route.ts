import { NextResponse } from "next/server";
import { getBusinessRow, relatedParts } from "@/lib/business";
import { CACHE } from "@/lib/queries";

// Comparables, banking relationships and other locations for a profile (?locations=0 skips the
// locations lookup when the list already knows there are none).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const biz = await getBusinessRow((await params).id);
  if (!biz) return NextResponse.json({ error: "not found" }, { status: 404 });
  const locations = new URL(req.url).searchParams.get("locations") !== "0";
  return NextResponse.json(await relatedParts(biz, { locations }), { headers: { "Cache-Control": CACHE } });
}
