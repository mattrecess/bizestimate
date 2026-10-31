import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { CACHE, parseFilters, relevance, where } from "@/lib/queries";
import { estimateValue } from "@/lib/valuation";

// Pin label: $1.2M / $850K.
const shortMoney = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.max(1, Math.round(v / 1e3))}K`);

// Lightweight GeoJSON for the map: biggest businesses first, capped.
export async function GET(req: NextRequest) {
  const f = parseFilters(req.nextUrl.searchParams);
  const rows = await sql`
    select id, name, lat, lon, naics, is_nonprofit, est_revenue_mid, est_ebitda_low, est_ebitda_mid, est_ebitda_high, est_value_mid, est_method
    from businesses
    where lat between 33.6 and 37.1 and lon between -103.1 and -94.4 and ${where(f)}   -- Oklahoma only (load.py also drops other pins)
    order by ${relevance(f)} est_revenue_mid desc nulls last limit 5000`;
  return NextResponse.json({
    type: "FeatureCollection",
    features: rows.map((r) => {
      // The tag shows estimated value, like a price: the stored value (it includes the admin's industry
      // multiples), as on the business page. Where a sale value doesn't apply (nonprofits, banks), revenue, marked "rev".
      const value = estimateValue(r as Parameters<typeof estimateValue>[0])?.mid;
      const shown = value ?? Number(r.est_revenue_mid);
      return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [r.lon, r.lat] },
      properties: {
        id: Number(r.id), name: r.name, rev: shown,
        label: shown > 0 ? (value ? shortMoney(shown) : `${shortMoney(shown)} rev`) : undefined,
        avg: r.est_method === "industry_average" ? 1 : 0,
      },
    }; }),
  }, { headers: { "Cache-Control": CACHE } });
}
