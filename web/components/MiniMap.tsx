"use client";
import dynamic from "next/dynamic";

const Map = dynamic(() => import("./Map"), { ssr: false });

export default function MiniMap({ lat, lon }: { lat: number; lon: number }) {
  const points: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: {} }],
  };
  return <div style={{ position: "relative", height: "100%" }}><Map points={points} center={[lon, lat]} zoom={12} /></div>;
}
