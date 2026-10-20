"use client";
import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";

// The worker is copied into /public by the postinstall script.
maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

const STYLE = process.env.NEXT_PUBLIC_MAP_STYLE || "https://tiles.openfreemap.org/styles/positron";
const OKLAHOMA: [number, number] = [-97.5, 35.5];

type Props = {
  points: GeoJSON.FeatureCollection | null;
  onBoundsChange?: (bbox: [number, number, number, number]) => void;
  center?: [number, number];
  zoom?: number;
};

export default function Map({ points, onBoundsChange, center = OKLAHOMA, zoom = 6 }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const boundsCb = useRef(onBoundsChange);
  boundsCb.current = onBoundsChange;

  useEffect(() => {
    const m = new maplibregl.Map({ container: el.current!, style: STYLE, center, zoom });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl(), "top-right");
    const emit = () => {
      const b = m.getBounds();
      boundsCb.current?.([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    };
    m.on("load", () => {
      m.addSource("biz", {
        type: "geojson", data: { type: "FeatureCollection", features: [] },
        cluster: true, clusterRadius: 40, clusterMaxZoom: 13,
      });
      m.addLayer({
        id: "clusters", type: "circle", source: "biz", filter: ["has", "point_count"],
        paint: {
          "circle-color": "#0b6bcb", "circle-opacity": 0.85,
          "circle-radius": ["step", ["get", "point_count"], 14, 50, 20, 500, 28],
        },
      });
      m.addLayer({
        id: "cluster-count", type: "symbol", source: "biz", filter: ["has", "point_count"],
        layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12, "text-font": ["Noto Sans Regular"] },
        paint: { "text-color": "#fff" },
      });
      m.addLayer({
        id: "points", type: "circle", source: "biz", filter: ["!", ["has", "point_count"]],
        paint: { "circle-color": "#e8590c", "circle-radius": 6, "circle-stroke-width": 1.5, "circle-stroke-color": "#fff" },
      });
      m.on("click", "clusters", async (e) => {
        const f = e.features![0];
        const src = m.getSource("biz") as maplibregl.GeoJSONSource;
        const z = await src.getClusterExpansionZoom(f.properties!.cluster_id);
        m.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom: z });
      });
      m.on("click", "points", (e) => {
        const p = e.features![0].properties!;
        const rev = Number(p.rev) >= 1e6 ? `$${(Number(p.rev) / 1e6).toFixed(1)}M` : `$${Math.round(Number(p.rev) / 1e3)}K`;
        const div = document.createElement("div");
        const a = document.createElement("a");
        a.href = `/business/${p.id}`;
        a.textContent = p.name;
        div.append(a, document.createElement("br"), `Est. revenue ${rev}`);
        new maplibregl.Popup().setLngLat(e.lngLat).setDOMContent(div).addTo(m);
      });
      for (const l of ["clusters", "points"]) {
        m.on("mouseenter", l, () => (m.getCanvas().style.cursor = "pointer"));
        m.on("mouseleave", l, () => (m.getCanvas().style.cursor = ""));
      }
      emit();
    });
    m.on("moveend", emit);
    return () => m.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !points) return;
    const apply = () => (m.getSource("biz") as maplibregl.GeoJSONSource | undefined)?.setData(points);
    if (m.isStyleLoaded() && m.getSource("biz")) apply();
    else m.once("idle", apply);
  }, [points]);

  return <div ref={el} style={{ position: "absolute", inset: 0 }} />;
}
