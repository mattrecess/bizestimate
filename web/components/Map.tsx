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
  onSelect?: (id: number) => void; // pin clicked; without it, pins open a popup link instead
  selected?: { lat: number; lon: number } | null; // highlighted pin
  hoveredId?: number | null; // business hovered in the list: its tag is raised and highlighted
  onHover?: (id: number | null) => void;
};

// Rounded price-tag image that stretches around its label (drawn at 2× for sharp edges).
function tagImage(fill: string, stroke: string) {
  const size = 48, r = 18, c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.beginPath();
  g.roundRect(2, 2, size - 4, size - 4, r);
  g.fillStyle = fill; g.fill();
  g.lineWidth = 3; g.strokeStyle = stroke; g.stroke();
  return { data: g.getImageData(0, 0, size, size), opts: { pixelRatio: 2, stretchX: [[20, 28]] as [number, number][], stretchY: [[20, 28]] as [number, number][] } };
}

const PPP = "#0b3b75", AVG = "#5b6b82", HOT = "#1f6feb";

// Business pins sit on top of whichever basemap is active; re-added after every style switch.
// Clusters while zoomed out; then each business is a dot with a revenue tag (tags hide where they'd overlap).
function addBizLayers(m: maplibregl.Map, data: GeoJSON.FeatureCollection, selected: GeoJSON.FeatureCollection, hover: GeoJSON.FeatureCollection) {
  if (m.getSource("biz")) return;
  for (const [name, fill] of [["tag", PPP], ["tag-avg", AVG], ["tag-hot", HOT]] as const) {
    if (!m.hasImage(name)) { const t = tagImage(fill, "#ffffff"); m.addImage(name, t.data, t.opts); }
  }
  m.addSource("biz", { type: "geojson", data, cluster: true, clusterRadius: 44, clusterMaxZoom: 12 });
  m.addLayer({
    id: "clusters", type: "circle", source: "biz", filter: ["has", "point_count"],
    paint: {
      "circle-color": PPP, "circle-opacity": 0.92, "circle-stroke-width": 2, "circle-stroke-color": "#fff",
      "circle-radius": ["step", ["get", "point_count"], 15, 50, 20, 500, 26, 5000, 32],
    },
  });
  m.addLayer({
    id: "cluster-count", type: "symbol", source: "biz", filter: ["has", "point_count"],
    layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12, "text-font": ["Noto Sans Bold"] },
    paint: { "text-color": "#fff" },
  });
  m.addLayer({
    id: "points", type: "circle", source: "biz", filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": ["case", ["==", ["get", "avg"], 1], AVG, PPP],
      "circle-radius": 5, "circle-stroke-width": 1.5, "circle-stroke-color": "#fff",
    },
  });
  m.addLayer({
    id: "tags", type: "symbol", source: "biz", filter: ["all", ["!", ["has", "point_count"]], ["has", "label"]],
    layout: {
      "icon-image": ["case", ["==", ["get", "avg"], 1], "tag-avg", "tag"],
      "icon-text-fit": "both", "icon-text-fit-padding": [2, 7, 4, 7],
      "text-field": ["get", "label"], "text-font": ["Noto Sans Bold"], "text-size": 12,
      "text-anchor": "bottom", "text-offset": [0, -0.85],
      // Biggest businesses win when tags collide.
      "symbol-sort-key": ["-", 0, ["get", "rev"]], "text-padding": 2,
    },
    paint: { "text-color": "#ffffff" },
  });
  m.addSource("hover", { type: "geojson", data: hover });
  m.addLayer({
    id: "hover", type: "symbol", source: "hover",
    layout: {
      "icon-image": "tag-hot", "icon-text-fit": "both", "icon-text-fit-padding": [3, 9, 5, 9],
      "text-field": ["get", "label"], "text-font": ["Noto Sans Bold"], "text-size": 13,
      "text-anchor": "bottom", "text-offset": [0, -0.85],
      "icon-allow-overlap": true, "text-allow-overlap": true,
    },
    paint: { "text-color": "#ffffff" },
  });
  m.addSource("selected", { type: "geojson", data: selected });
  m.addLayer({
    id: "selected", type: "circle", source: "selected",
    paint: { "circle-color": HOT, "circle-radius": 9, "circle-stroke-width": 3, "circle-stroke-color": "#fff" },
  });
}

const pointFC = (p: { lat: number; lon: number } | null | undefined): GeoJSON.FeatureCollection => ({
  type: "FeatureCollection",
  features: p ? [{ type: "Feature", geometry: { type: "Point", coordinates: [p.lon, p.lat] }, properties: {} }] : [],
});

const shortMoney = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.max(1, Math.round(v / 1e3))}K`);

const hoverFC = (points: GeoJSON.FeatureCollection, id: number | null | undefined): GeoJSON.FeatureCollection => ({
  type: "FeatureCollection",
  features: id == null ? [] : points.features.filter((f) => f.properties?.id === id).slice(0, 1),
});

export default function Map({ points, onBoundsChange, center = OKLAHOMA, zoom = 6, fitKey = "", onSelect, selected, hoveredId, onHover }: Props) {
  const fitted = useRef("");
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const latest = useRef<GeoJSON.FeatureCollection>(EMPTY);
  const boundsCb = useRef(onBoundsChange);
  boundsCb.current = onBoundsChange;
  const selectCb = useRef(onSelect);
  selectCb.current = onSelect;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const hoverCb = useRef(onHover);
  hoverCb.current = onHover;
  const hoveredRef = useRef(hoveredId);
  hoveredRef.current = hoveredId;
  const [satellite, setSatellite] = useState(true);

  useEffect(() => {
    const m = new maplibregl.Map({ container: el.current!, style: SATELLITE, center, zoom });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl(), "top-right");
    const emit = () => {
      const b = m.getBounds();
      boundsCb.current?.([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    };
    m.on("style.load", () => addBizLayers(m, latest.current, pointFC(selectedRef.current), hoverFC(latest.current, hoveredRef.current)));
    m.on("click", "clusters", async (e) => {
      const f = e.features![0];
      const src = m.getSource("biz") as maplibregl.GeoJSONSource;
      const z = await src.getClusterExpansionZoom(f.properties!.cluster_id);
      m.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom: z });
    });
    const hover = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: [0, -34] });
    const pins = ["points", "tags"];
    m.on("click", pins, (e) => {
      const p = e.features![0].properties!;
      if (selectCb.current) {
        hover.remove();
        selectCb.current(Number(p.id));
        return;
      }
      const div = document.createElement("div");
      const a = document.createElement("a");
      a.href = `/business/${p.id}`;
      a.textContent = p.name;
      div.append(a, document.createElement("br"), `Est. revenue ${shortMoney(Number(p.rev))}`);
      new maplibregl.Popup().setLngLat(e.lngLat).setDOMContent(div).addTo(m);
    });
    // Name on hover (the tag already shows revenue), and the matching card is highlighted.
    let hovering: number | null = null;
    m.on("mousemove", pins, (e) => {
      if (!selectCb.current) return;
      const f = e.features![0];
      const id = Number(f.properties!.id);
      if (id === hovering) return;
      hovering = id;
      hoverCb.current?.(id);
      const strong = document.createElement("strong");
      strong.textContent = f.properties!.name;
      hover.setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number]).setDOMContent(strong).addTo(m);
    });
    m.on("mouseleave", pins, () => { hovering = null; hover.remove(); hoverCb.current?.(null); });
    for (const l of ["clusters", ...pins]) {
      m.on("mouseenter", l, () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", l, () => (m.getCanvas().style.cursor = ""));
    }
    // The container can still be settling its size at creation; recentre once it has.
    m.on("load", () => { m.resize(); if (!boundsCb.current) m.jumpTo({ center }); });
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

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    (m.getSource("selected") as maplibregl.GeoJSONSource | undefined)?.setData(pointFC(selected));
    // Bring the selected business into view if it's off-screen (e.g. picked from comparables).
    if (selected && !m.getBounds().contains([selected.lon, selected.lat])) {
      m.easeTo({ center: [selected.lon, selected.lat], zoom: Math.max(m.getZoom(), 14), duration: 800 });
    }
  }, [selected]);

  useEffect(() => {
    (map.current?.getSource("hover") as maplibregl.GeoJSONSource | undefined)?.setData(hoverFC(latest.current, hoveredId));
  }, [hoveredId, points]);

  function toggle() {
    const next = !satellite;
    setSatellite(next);
    map.current?.setStyle(next ? SATELLITE : STREETS);
  }

  return (
    <>
      <div ref={el} style={{ position: "absolute", inset: 0 }} />
      <button className="map-toggle" onClick={toggle}>{satellite ? "Map" : "Satellite"}</button>
      {onSelect && <div className="legend" aria-hidden>
        <span><i style={{ background: PPP }} />PPP loan data</span>
        <span><i style={{ background: AVG }} />Industry average</span>
      </div>}
    </>
  );
}
