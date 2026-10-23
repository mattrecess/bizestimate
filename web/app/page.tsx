"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import BusinessProfile, { type Profile } from "@/components/BusinessProfile";
import BizCard, { type Biz } from "@/components/BizCard";
import FilterBar, { type FilterState } from "@/components/FilterBar";
import Icon from "@/components/Icon";
import SearchBox from "@/components/SearchBox";

const Map = dynamic(() => import("@/components/Map"), { ssr: false });
const PAGE = 50;
const NO_FILTERS: FilterState = { sector: "", city: "", minRev: "", maxRev: "", sort: "revenue_desc" };

// Filters are mirrored into the page URL so a search can be bookmarked or shared.
const URL_KEYS = ["q", "sector", "city", "min_rev", "max_rev", "sort", "id"] as const;

export default function Home() {
  const [ready, setReady] = useState(false);
  const [cities, setCities] = useState<{ city: string; count: number }[]>([]);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [filters, setFilters] = useState<FilterState>(NO_FILTERS);
  const [bbox, setBbox] = useState<[number, number, number, number] | null>(null);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ total: number; results: Biz[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [points, setPoints] = useState<GeoJSON.FeatureCollection | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  // Phones show the map or the list, not both.
  const [view, setView] = useState<"map" | "list">("map");
  // Business shown in the side panel (replaces the list until "Back").
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const listScroll = useRef(0);
  const { sector, city, minRev, maxRev, sort } = filters;

  function openBusiness(id: number) {
    if (!selectedId) listScroll.current = panel.current?.scrollTop ?? 0;
    setSelectedId(id);
    setView("list");
  }

  useEffect(() => {
    const u = new URLSearchParams(window.location.search);
    setQ(u.get("q") ?? ""); setDebouncedQ(u.get("q") ?? "");
    setFilters({
      sector: u.get("sector") ?? "", city: u.get("city") ?? "",
      minRev: u.get("min_rev") ?? "", maxRev: u.get("max_rev") ?? "", sort: u.get("sort") ?? "revenue_desc",
    });
    // A shared link to a business opens its profile (on phones, the list side rather than the map).
    if (u.get("id") && /^\d+$/.test(u.get("id")!)) { setSelectedId(Number(u.get("id"))); setView("list"); }
    setReady(true);
    fetch("/api/cities").then((r) => r.json()).then(setCities).catch(() => {});
  }, []);

  useEffect(() => {
    if (!ready) return;
    const values: Record<(typeof URL_KEYS)[number], string> = {
      q: debouncedQ, sector, city, min_rev: minRev, max_rev: maxRev, sort: sort === "revenue_desc" ? "" : sort,
      id: selectedId ? String(selectedId) : "",
    };
    const u = new URLSearchParams();
    for (const k of URL_KEYS) if (values[k]) u.set(k, values[k]);
    const qs = u.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [ready, debouncedQ, sector, city, minRev, maxRev, sort, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setProfile(null);
      requestAnimationFrame(() => panel.current?.scrollTo({ top: listScroll.current }));
      return;
    }
    const ctrl = new AbortController();
    fetch(`/api/businesses/${selectedId}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => { setProfile(p); if (!p) setSelectedId(null); })
      .catch(() => {});
    panel.current?.scrollTo({ top: 0 });
    return () => ctrl.abort();
  }, [selectedId]);

  const selectedPoint = useMemo(
    () => (profile?.lat != null ? { lat: Number(profile.lat), lon: Number(profile.lon) } : null),
    [profile],
  );

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const fitKey = city || debouncedQ ? `${city}|${debouncedQ}` : "";

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (debouncedQ) p.set("q", debouncedQ);
    if (sector) p.set("sector", sector);
    if (city) p.set("city", city);
    if (minRev) p.set("min_rev", minRev);
    if (maxRev) p.set("max_rev", maxRev);
    // A city or name search covers the whole state; the map then flies to the matches.
    if (bbox && !fitKey) p.set("bbox", bbox.map((n) => n.toFixed(4)).join(","));
    return p;
  }, [debouncedQ, sector, city, minRev, maxRev, bbox, fitKey]);

  useEffect(() => setOffset(0), [params, sort]);

  useEffect(() => {
    if (!ready) return;
    const ctrl = new AbortController();
    const p = new URLSearchParams(params);
    p.set("sort", sort); p.set("limit", String(PAGE)); p.set("offset", String(offset));
    setLoading(true);
    setFailed(false);
    const load = (retries: number): Promise<void> =>
      fetch(`/api/businesses?${p}`, { signal: ctrl.signal })
        .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
        .then((d) => { setData(d); setLoading(false); })
        .catch((e) => {
          if (ctrl.signal.aborted) return;
          // One quiet retry covers a cold start or a busy database; after that, offer a button.
          if (retries > 0) return new Promise<void>((ok) => setTimeout(ok, 1500)).then(() => load(retries - 1));
          console.error("business list failed", e);
          setLoading(false);
          setFailed(true);
        });
    load(1);
    return () => ctrl.abort();
  }, [ready, params, sort, offset, attempt]);

  useEffect(() => {
    if (!ready) return;
    const ctrl = new AbortController();
    setPoints(null); // so the map never fits to the previous search's pins
    fetch(`/api/points?${params}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null)).then((d) => d && setPoints(d)).catch(() => {});
    return () => ctrl.abort();
  }, [ready, params, attempt]);

  function changePage(next: number) {
    setOffset(next);
    panel.current?.scrollTo({ top: 0 });
  }

  const anyFilter = debouncedQ || sector || city || minRev || maxRev;
  const total = data?.total ?? 0;

  return (
    <>
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} onPick={openBusiness} />
        <FilterBar value={filters} cities={cities} onChange={(next) => setFilters((f) => ({ ...f, ...next }))} />
      </div>
      <div className="explorer" data-view={view}>
        <div className="map">
          <Map points={points} onBoundsChange={setBbox} fitKey={fitKey} onSelect={openBusiness}
            selected={selectedPoint} hoveredId={hovered} onHover={setHovered} />
        </div>
        <div className="panel" ref={panel}>
          {selectedId && (
            <div className="detail">
              <div className="detail-bar">
                <button className="btn" onClick={() => setSelectedId(null)} aria-label="Back to list">
                  <Icon name="back" size={16} />Back to list
                </button>
                <a className="link-btn" href={`/business/${selectedId}`} target="_blank" rel="noopener">
                  Full page <Icon name="external" size={14} />
                </a>
              </div>
              {profile && Number(profile.id) === selectedId
                ? <BusinessProfile b={profile} compact onSelect={openBusiness} />
                : <div className="cards"><div className="skeleton" style={{ height: 90 }} /><div className="skeleton" style={{ height: 220 }} /></div>}
            </div>
          )}
          {/* The list stays mounted while a profile is open, so Back returns to the same scroll position. */}
          <div style={{ display: selectedId ? "none" : undefined }}>
            <div className="list-head">
              <span className="count">
                {failed ? "Couldn't load businesses" : data ? `${total.toLocaleString()} ${total === 1 ? "business" : "businesses"}` : "Loading…"}
              </span>
              <span className="sub">{fitKey ? "matching your search" : "in map view"} · estimates</span>
            </div>
            {failed && (
              <div className="empty">
                <h3>Something went wrong loading businesses</h3>
                <p>The database may be busy. Try again in a moment.</p>
                <button className="btn primary" onClick={() => setAttempt((a) => a + 1)}>Retry</button>
              </div>
            )}
            <div className="cards" aria-busy={loading}>
              {!data && !failed && Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton" />)}
              {data?.results.map((b) => (
                <BizCard key={b.id} b={b} hovered={hovered === Number(b.id)} onOpen={openBusiness} onHover={setHovered} />
              ))}
            </div>
            {data && total === 0 && (
              <div className="empty">
                <Icon name="search" size={28} />
                <h3>No businesses found</h3>
                <p>{anyFilter ? "Try a different spelling, or loosen the filters." : "Zoom out or move the map to see more."}</p>
                {anyFilter && (
                  <button className="btn" onClick={() => { setQ(""); setFilters((f) => ({ ...NO_FILTERS, sort: f.sort })); }}>
                    Clear search and filters
                  </button>
                )}
              </div>
            )}
            {data && total > PAGE && (
              <div className="pager">
                <button className="btn" disabled={offset === 0} onClick={() => changePage(Math.max(0, offset - PAGE))}>Previous</button>
                <span>{(offset + 1).toLocaleString()}–{Math.min(offset + PAGE, total).toLocaleString()} of {total.toLocaleString()}</span>
                <button className="btn" disabled={offset + PAGE >= total} onClick={() => changePage(offset + PAGE)}>Next</button>
              </div>
            )}
          </div>
        </div>
        <button className="btn primary view-toggle" onClick={() => setView(view === "map" ? "list" : "map")}>
          <Icon name={view === "map" ? "list" : "map"} size={16} />{view === "map" ? "List" : "Map"}
        </button>
      </div>
    </>
  );
}
