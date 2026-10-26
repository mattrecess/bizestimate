import { NextRequest, NextResponse } from "next/server";
import { compareRows } from "@/lib/compare";

// Summary rows for saved businesses (the Saved page).
export async function GET(req: NextRequest) {
  const ids = (req.nextUrl.searchParams.get("ids") ?? "").split(",").filter((s) => /^\d+$/.test(s)).slice(0, 100);
  return NextResponse.json(await compareRows(ids), { headers: { "Cache-Control": "private, max-age=60" } });
}
