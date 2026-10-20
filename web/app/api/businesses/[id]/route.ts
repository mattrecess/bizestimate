import { NextResponse } from "next/server";
import { getBusiness } from "@/lib/business";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const biz = await getBusiness((await params).id);
  return biz ? NextResponse.json(biz) : NextResponse.json({ error: "not found" }, { status: 404 });
}
