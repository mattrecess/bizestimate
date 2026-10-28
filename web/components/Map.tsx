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
  area?: [number, number][] | null;             // a shape drawn to search inside
  onArea?: (area: [number, number][] | null) => void;
};

const MAX_AREA_POINTS = 60;
const areaFC = (pts: [number, number][] | null | undefined, closed = true): GeoJSON.FeatureCollection => ({
  type: "FeatureCollection",
  features: pts && pts.length >= 2 ? [{
    type: "Feature", properties: {},
    geometry: closed && pts.length >= 3 ? { type: "Polygon", coordinates: [[...pts, pts[0]]] } : { type: "LineString", coordinates: pts },
  }] : [],
});

// The drawn search area (and the line being drawn), under the pins; re-added after a style switch.
function addAreaLayers(m: maplibregl.Map, area: [number, number][] | null | undefined) {
  if (m.getSource("area")) return;
  m.addSource("area", { type: "geojson", data: areaFC(area) });
  m.addSource("drawing", { type: "geojson", data: areaFC(null) });
  const below = m.getLayer("points") ? "points" : undefined;
  m.addLayer({ id: "area-fill", type: "fill", source: "area", paint: { "fill-color": HOT, "fill-opacity": 0.08 } }, below);
  m.addLayer({ id: "area-line", type: "line", source: "area", paint: { "line-color": HOT, "line-width": 2.5 } }, below);
  m.addLayer({ id: "drawing-line", type: "line", source: "drawing", paint: { "line-color": HOT, "line-width": 2.5, "line-dasharray": [2, 1.5] } });
}

// Zillow-style price tag: a rounded pill that stretches around its label, with a small pointer at the
// bottom whose tip marks the spot (drawn at 2x for sharp edges). Only the straight parts stretch, so the
// corners stay round and the pointer stays centred and the same size.
const TAG_W = 64, TAG_H = 54;
function tagImage(fill: string, stroke: string) {
  const c = document.createElement("canvas");
  c.width = TAG_W; c.height = TAG_H;
  const g = c.getContext("2d")!;
  const top = 3, bottom = 40, left = 3, right = TAG_W - 3, r = 14, mid = TAG_W / 2, tail = 8, tip = TAG_H - 3;
  g.beginPath();
  g.moveTo(left + r, top);
  g.arcTo(right, top, right, bottom, r);
  g.arcTo(right, bottom, left, bottom, r);
  g.lineTo(mid + tail, bottom);
  g.lineTo(mid, tip);
  g.lineTo(mid - tail, bottom);
  g.arcTo(left, bottom, left, top, r);
  g.arcTo(left, top, right, top, r);
  g.closePath();
  g.fillStyle = fill; g.fill();
  g.lineWidth = 3; g.lineJoin = "round"; g.strokeStyle = stroke; g.stroke();
  return {
    data: g.getImageData(0, 0, TAG_W, TAG_H),
    opts: {
      pixelRatio: 2,
      stretchX: [[left + r + 1, mid - tail - 1], [mid + tail + 1, right - r - 1]] as [number, number][],
      stretchY: [[top + r + 1, bottom - r - 1]] as [number, number][],
      content: [left + 8, top + 4, right - 8, bottom - 4] as [number, number, number, number],
    },
  };
}

// Small dot: every business, visible where its tag is hidden by a bigger neighbour's.
function dotImage(fill: string) {
  const c = document.createElement("canvas");
  c.width = c.height = 12;
  const g = c.getContext("2d")!;
  g.beginPath(); g.arc(6, 6, 4, 0, Math.PI * 2);
  g.fillStyle = fill; g.fill(); g.lineWidth = 1.5; g.strokeStyle = "#ffffff"; g.stroke();
  return { data: g.getImageData(0, 0, 12, 12), opts: { pixelRatio: 2 } };
}

// Lifts a label so the tag's pointer tip (padding + pointer below the text) lands on the point.
const TIP_OFFSET: [number, number] = [0, -0.95];

const PPP = "#0b3b75", AVG = "#5b6b82", HOT = "#1f6feb";

// Business pins sit on top of whichever basemap is active; re-added after every style switch.
// Each business is a revenue tag, or a small dot where its tag would overlap a bigger business's.
function addBizLayers(m: maplibregl.Map, data: GeoJSON.FeatureCollection, selected: GeoJSON.FeatureCollection, hover: GeoJSON.FeatureCollection) {
  if (m.getSource("biz")) return;
  for (const [name, fill] of [["tag", PPP], ["tag-avg", AVG], ["tag-hot", HOT]] as const) {
    if (!m.hasImage(name)) { const t = tagImage(fill, "#ffffff"); m.addImage(name, t.data, t.opts); }
  }
  for (const [name, fill] of [["dot", PPP], ["dot-avg", AVG]] as const) {
    if (!m.hasImage(name)) { const d = dotImage(fill); m.addImage(name, d.data, d.opts); }
  }
  // No clustering (as on Zillow): every business is a pin; the biggest get price tags where there's room.
  m.addSource("biz", { type: "geojson", data });
  // Every business is a small dot (they may overlap, showing density, as on Zillow) drawn under the
  // tags. Each dot sits just above its point, inside where the tag's pointer goes, so a business with
  // a tag shows only the tag.
  m.addLayer({
    id: "points", type: "symbol", source: "biz",
    layout: {
      "icon-image": ["case", ["==", ["get", "avg"], 1], "dot-avg", "dot"],
      "icon-offset": [0, -5], "icon-allow-overlap": true, "icon-ignore-placement": true,
    },
  });
  m.addLayer({
    id: "tags", type: "symbol", source: "biz", filter: ["has", "label"],
    layout: {
      "icon-image": ["case", ["==", ["get", "avg"], 1], "tag-avg", "tag"],
      "icon-text-fit": "both", "icon-text-fit-padding": [2, 2, 3, 2],
      "text-field": ["get", "label"], "text-font": ["Noto Sans Bold"], "text-size": 12,
      "text-anchor": "bottom", "text-offset": TIP_OFFSET,
      // Biggest businesses win when tags collide.
      "symbol-sort-key": ["-", 0, ["get", "rev"]], "text-padding": 2,
    },
    paint: { "text-color": "#ffffff" },
  });
  // The hovered business: a bright tag with its name, drawn over everything without moving other tags.
  m.addSource("hover", { type: "geojson", data: hover });
  m.addLayer({
    id: "hover", type: "symbol", source: "hover",
    layout: {
      "icon-image": "tag-hot", "icon-text-fit": "both", "icon-text-fit-padding": [3, 4, 4, 4],
      "text-field": ["case", ["has", "name"], ["concat", ["get", "name"], "  ·  ", ["coalesce", ["get", "label"], ""]], ["get", "label"]],
      "text-font": ["Noto Sans Bold"], "text-size": 13, "text-max-width": 30,
      "text-anchor": "bottom", "text-offset": TIP_OFFSET,
      "icon-allow-overlap": true, "text-allow-overlap": true, "icon-ignore-placement": true, "text-ignore-placement": true,
    },
    paint: { "text-color": "#ffffff" },
  });
  m.addSource("selected", { type: "geojson", data: selected });
  m.addLayer({
    id: "selected", type: "circle", source: "selected",
    paint: { "circle-color": HOT, "circle-radius": 6, "circle-stroke-width": 2.5, "circle-stroke-color": "#fff" },
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

export default function Map({ points, onBoundsChange, center = OKLAHOMA, zoom = 6, fitKey = "", onSelect, selected, hoveredId, onHover, area, onArea }: Props) {
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
  const [drawing, setDrawing] = useState(false);
  const areaRef = useRef(area);
  areaRef.current = area;
  const areaCb = useRef(onArea);
  areaCb.current = onArea;

  useEffect(() => {
    // No fade: tags changing as data or the hover updates otherwise blink.
    const m = new maplibregl.Map({ container: el.current!, style: SATELLITE, center, zoom, fadeDuration: 0 });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl(), "top-right");
    const emit = () => {
      const b = m.getBounds();
      boundsCb.current?.([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    };
    m.on("style.load", () => {
      addBizLayers(m, latest.current, pointFC(selectedRef.current), hoverFC(latest.current, hoveredRef.current));
      addAreaLayers(m, areaRef.current);
    });
    const pins = ["points", "tags"];
    m.on("click", pins, (e) => {
      const p = e.features![0].properties!;
      if (selectCb.current) {
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
    // Hover: the tag turns bright and shows the name (the hover layer), and the matching card is
    // highlighted. Nothing is drawn under the pointer, so the hover can't cancel itself.
    let hovering: number | null = null;
    m.on("mousemove", pins, (e) => {
      if (!selectCb.current) return;
      const id = Number(e.features![0].properties!.id);
      if (id === hovering) return;
      hovering = id;
      hoverCb.current?.(id);
    });
    m.on("mouseleave", pins, () => { hovering = null; hoverCb.current?.(null); });
    for (const l of pins) {
      m.on("mouseenter", l, () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", l, () => (m.getCanvas().style.cursor = ""));
    }
    // The container can still be settling its size at creation; recentre once it has.
    m.on("load", () => { m.resize(); if (!boundsCb.current) m.jumpTo({ center }); });
    // Report the view only when it actually moves (dragging, zooming, a cluster click, flying to
    // results), not for the initial view or a resize: an early report would cancel the page's
    // first, whole-state requests and start slower uncached ones.
    m.on("moveend", (e: maplibregl.MapLibreEvent & { user?: boolean }) => { if (e.originalEvent || e.user) emit(); });
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
      map.current.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 800 }, { user: true });
    }
    if (!fitKey) fitted.current = "";
  }, [points, fitKey]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    (m.getSource("selected") as maplibregl.GeoJSONSource | undefined)?.setData(pointFC(selected));
    // Bring the selected business into view if it's off-screen (e.g. picked from comparables).
    if (selected && !m.getBounds().contains([selected.lon, selected.lat])) {
      m.easeTo({ center: [selected.lon, selected.lat], zoom: Math.max(m.getZoom(), 14), duration: 800 }, { user: true });
    }
  }, [selected]);

  useEffect(() => {
    (map.current?.getSource("hover") as maplibregl.GeoJSONSource | undefined)?.setData(hoverFC(latest.current, hoveredId));
  }, [hoveredId, points]);

  useEffect(() => {
    (map.current?.getSource("area") as maplibregl.GeoJSONSource | undefined)?.setData(areaFC(area));
  }, [area]);

  // Draw mode: press and drag a loop around the businesses you want; letting go searches inside it.
  useEffect(() => {
    const m = map.current;
    if (!m || !drawing) return;
    const canvas = m.getCanvasContainer();
    const pts: [number, number][] = [];
    let down = false;
    m.dragPan.disable(); m.touchZoomRotate.disable(); m.doubleClickZoom.disable();
    canvas.style.cursor = "crosshair";
    const at = (e: PointerEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      const ll = m.unproject([e.clientX - r.left, e.clientY - r.top]);
      return [Number(ll.lng.toFixed(5)), Number(ll.lat.toFixed(5))];
    };
    const draw = () => (m.getSource("drawing") as maplibregl.GeoJSONSource | undefined)?.setData(areaFC(pts, false));
    const onDown = (e: PointerEvent) => { down = true; pts.length = 0; pts.push(at(e)); canvas.setPointerCapture(e.pointerId); e.preventDefault(); };
    const onMove = (e: PointerEvent) => { if (down) { pts.push(at(e)); draw(); } };
    const onUp = () => {
      if (!down) return;
      down = false;
      (m.getSource("drawing") as maplibregl.GeoJSONSource | undefined)?.setData(areaFC(null));
      if (pts.length >= 3) {
        const step = Math.ceil(pts.length / MAX_AREA_POINTS);
        areaCb.current?.(pts.filter((_, i) => i % step === 0));
      }
      setDrawing(false);
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      m.dragPan.enable(); m.touchZoomRotate.enable(); m.doubleClickZoom.enable();
      canvas.style.cursor = "";
    };
  }, [drawing]);

  function toggle() {
    const next = !satellite;
    setSatellite(next);
    map.current?.setStyle(next ? SATELLITE : STREETS);
  }

  return (
    <>
      <div ref={el} style={{ position: "absolute", inset: 0 }} />
      <button className="map-toggle" onClick={toggle}>{satellite ? "Map" : "Satellite"}</button>
      {onArea && (
        <div className="draw-controls">
          {drawing ? <span className="draw-hint">Drag a loop around an area…</span>
            : area ? <button className="map-btn" onClick={() => onArea(null)}>Remove area</button>
            : null}
          <button className={`map-btn ${drawing ? "active" : ""}`} onClick={() => setDrawing((d) => !d)}>{drawing ? "Cancel" : "Draw"}</button>
        </div>
      )}
      {onSelect && <div className="legend" aria-hidden>
        <span><i style={{ background: PPP }} />PPP or 401(k) data</span>
        <span><i style={{ background: AVG }} />Industry average</span>
      </div>}
    </>
  );
}
