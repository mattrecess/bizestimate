"use client";
import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";

// The worker is copied into /public by the postinstall script.
maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
const SATELLITE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {
    imagery: {
      type: "raster", tileSize: 256, maxzoom: 19,
      tiles: [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`],
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    },
    labels: {
      type: "raster", tileSize: 256, maxzoom: 19,
      tiles: [`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`],
    },
    roads: {
      type: "raster", tileSize: 256, maxzoom: 19,
      tiles: [`${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`],
    },
  },
  layers: [
    { id: "imagery", type: "raster", source: "imagery" },
    { id: "roads", type: "raster", source: "roads", minzoom: 10, paint: { "raster-opacity": 0.7 } },
    { id: "labels", type: "raster", source: "labels" },
  ],
};
const STREETS = process.env.NEXT_PUBLIC_MAP_STYLE || "https://tiles.openfreemap.org/styles/positron";
const OKLAHOMA: [number, number] = [-97.5, 35.5];
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

type Props = {
  points: GeoJSON.FeatureCollection | null;
  onBoundsChange?: (bbox: [number, number, number, number]) => void;
  center?: [number, number];
  zoom?: number;
  fitKey?: string; // when this changes, zoom to the next set of points
};

// Business pins sit on top of whichever basemap is active; re-added after every style switch.
function addBizLayers(m: maplibregl.Map, data: GeoJSON.FeatureCollection) {
  if (m.getSource("biz")) return;
  m.addSource("biz", { type: "geojson", data, cluster: true, clusterRadius: 40, clusterMaxZoom: 13 });
  m.addLayer({
    id: "clusters", type: "circle", source: "biz", filter: ["has", "point_count"],
    paint: {
      "circle-color": "#0b6bcb", "circle-opacity": 0.9, "circle-stroke-width": 1.5, "circle-stroke-color": "#fff",
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
    paint: { "circle-color": "#ff6a13", "circle-radius": 6, "circle-stroke-width": 2, "circle-stroke-color": "#fff" },
  });
}

export default function Map({ points, onBoundsChange, center = OKLAHOMA, zoom = 6, fitKey = "" }: Props) {
  const fitted = useRef("");
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const latest = useRef<GeoJSON.FeatureCollection>(EMPTY);
  const boundsCb = useRef(onBoundsChange);
  boundsCb.current = onBoundsChange;
  const [satellite, setSatellite] = useState(true);

  useEffect(() => {
    const m = new maplibregl.Map({ container: el.current!, style: SATELLITE, center, zoom });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl(), "top-right");
    const emit = () => {
      const b = m.getBounds();
      boundsCb.current?.([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    };
    m.on("style.load", () => addBizLayers(m, latest.current));
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
    m.on("load", emit);
    m.on("moveend", emit);
    return () => m.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!points) return;
    latest.current = points;
    (map.current?.getSource("biz") as maplibregl.GeoJSONSource | undefined)?.setData(points);
    if (fitKey && fitKey !== fitted.current && points.features.length && map.current) {
      fitted.current = fitKey;
      const bounds = new maplibregl.LngLatBounds();
      for (const f of points.features) bounds.extend((f.geometry as GeoJSON.Point).coordinates as [number, number]);
      map.current.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 800 });
    }
    if (!fitKey) fitted.current = "";
  }, [points, fitKey]);

  function toggle() {
    const next = !satellite;
    setSatellite(next);
    map.current?.setStyle(next ? SATELLITE : STREETS);
  }

  return (
    <>
      <div ref={el} style={{ position: "absolute", inset: 0 }} />
      <button className="map-toggle" onClick={toggle}>{satellite ? "Map" : "Satellite"}</button>
    </>
  );
}
