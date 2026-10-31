import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { CACHE, mapSimple, mapWhere, parseFilters, relevance, where } from "@/lib/queries";

// Pin label: $1.2M / $850K.
const shortMoney = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.max(1, Math.round(v / 1e3))}K`);

// Lightweight GeoJSON for the map: biggest businesses first, capped.
export async function GET(req: NextRequest) {
  const f = parseFilters(req.nextUrl.searchParams);
  const full = () => sql`
    select id, name, lat, lon, est_revenue_mid, est_value_mid, est_method
    from businesses
    where lat between 33.6 and 37.1 and lon between -103.1 and -94.4 and ${where(f)}   -- Oklahoma only (load.py also drops other pins)
    order by ${relevance(f)} est_revenue_mid desc nulls last limit 5000`;
  // A plain map view reads the slim map_points table (a few MB, kept in memory); searches and
  // other filters need the full table, as does any view before the load has built map_points.
  const rows = mapSimple(f)
    ? await sql`select id, name, lat, lon, est_revenue_mid, est_value_mid, est_method from map_points
        where ${mapWhere(f)} order by est_revenue_mid desc nulls last limit 5000`.catch(full)
    : await full();
  return NextResponse.json({
    type: "FeatureCollection",
    features: rows.map((r) => {
      // The tag shows estimated value, like a price (revenue where a sale value doesn't apply).
      const shown = Number(r.est_value_mid) > 0 ? Number(r.est_value_mid) : Number(r.est_revenue_mid);
      return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [r.lon, r.lat] },
      properties: {
        id: Number(r.id), name: r.name, rev: shown,
        label: shown > 0 ? shortMoney(shown) : undefined,
        avg: r.est_method === "industry_average" ? 1 : 0,
      },
    }; }),
  }, { headers: { "Cache-Control": CACHE } });
}
