import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { parseFilters, where } from "@/lib/queries";

// Lightweight GeoJSON for the map: biggest businesses first, capped.
export async function GET(req: NextRequest) {
  const rows = await sql`
    select id, name, lat, lon, est_revenue_mid from businesses
    where lat is not null and ${where(parseFilters(req.nextUrl.searchParams))}
    order by est_revenue_mid desc nulls last limit 5000`;
  return NextResponse.json({
    type: "FeatureCollection",
    features: rows.map((r) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [r.lon, r.lat] },
      properties: { id: Number(r.id), name: r.name, rev: Number(r.est_revenue_mid) },
    })),
  });
}
