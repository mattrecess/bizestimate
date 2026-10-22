import { NextResponse } from "next/server";
import { getBusiness, getComparables } from "@/lib/business";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const biz = await getBusiness((await params).id);
  if (!biz) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ...biz, comps: await getComparables(biz) });
}
