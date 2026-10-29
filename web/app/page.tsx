"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import BusinessProfile, { type Profile } from "@/components/BusinessProfile";
import BizCard, { type Biz } from "@/components/BizCard";
import FilterBar, { type FilterState } from "@/components/FilterBar";
import { saveSearch } from "@/lib/saved";
import { moreFrom } from "@/lib/more-filters";
import Icon from "@/components/Icon";
import SearchBox from "@/components/SearchBox";

const Map = dynamic(() => import("@/components/Map"), { ssr: false });
const PAGE = 50;
const PIN_LIMIT = 5000;   // /api/points cap: a capped result means zooming in can reveal more

type Box = [number, number, number, number]; // west, south, east, north
// Pins are fetched for the view plus half a screen on each side, on a coarse grid, so small pans
// need no new request and repeat views share a CDN-cached URL.
function padBox([w, s, e, n]: Box): Box {
  const dx = (e - w) / 2, dy = (n - s) / 2, g = 0.05;
  return [Math.floor((w - dx) / g) * g, Math.floor((s - dy) / g) * g, Math.ceil((e + dx) / g) * g, Math.ceil((n + dy) / g) * g];
}
const inside = (a: Box, b: Box) => a[0] >= b[0] && a[1] >= b[1] && a[2] <= b[2] && a[3] <= b[3];
const NO_FILTERS: FilterState = { sector: "", city: "", minRev: "", maxRev: "", sort: "revenue_desc", naics: "", lender: "", more: "" };

// Filters are mirrored into the page URL so a search can be bookmarked or shared.
const URL_KEYS = ["q", "sector", "city", "min_rev", "max_rev", "naics", "lender", "sort", "id"] as const;

export default function Home() {
  const [ready, setReady] = useState(false);
  const [cities, setCities] = useState<{ city: string; count: number }[]>([]);
  const [savedNote, setSavedNote] = useState(false);
  // A shape drawn on the map ("lon,lat;lon,lat;..."): the search covers it instead of the map view.
  const [area, setArea] = useState("");
  const areaPts = useMemo(() => (area ? area.split(";").map((p) => p.split(",").map(Number) as [number, number]) : null), [area]);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [filters, setFilters] = useState<FilterState>(NO_FILTERS);
  const [bbox, setBbox] = useState<[number, number, number, number] | null>(null);
  // Continuous scroll: how far the list has been extended, for which search (a new search starts over).
  const [more, setMore] = useState({ key: "", offset: 0 });
  const [data, setData] = useState<{ key: string; total: number; capped?: boolean; approx?: number | null; results: Biz[]; q: string; industry?: string | null } | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [pinsLoading, setPinsLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [points, setPoints] = useState<GeoJSON.FeatureCollection | null>(null);
  const [pinArea, setPinArea] = useState<Box | null>(null);
  const pinsCapped = useRef(false);
  const pinsFitKey = useRef<string | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  // Phones show the map or the list, not both.
  const [view, setView] = useState<"map" | "list">("map");
  // Business shown in the side panel (replaces the list until "Back").
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const listScroll = useRef(0);
  const { sector, city, minRev, maxRev, sort, naics, lender, more: moreFilters } = filters;

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
      naics: u.get("naics") ?? "", lender: u.get("lender") ?? "", more: moreFrom(u),
    });
    // A shared link to a business opens its profile (on phones, the list side rather than the map).
    if (u.get("id") && /^\d+$/.test(u.get("id")!)) { setSelectedId(Number(u.get("id"))); setView("list"); }
    setArea(u.get("area") ?? "");
    setReady(true);
    fetch("/api/cities").then((r) => r.json()).then(setCities).catch(() => {});
  }, []);

  useEffect(() => {
    if (!ready) return;
    const values: Record<(typeof URL_KEYS)[number], string> = {
      q: debouncedQ, sector, city, min_rev: minRev, max_rev: maxRev, naics, lender, sort: sort === "revenue_desc" ? "" : sort,
      id: selectedId ? String(selectedId) : "",
    };
    const u = new URLSearchParams();
    for (const k of URL_KEYS) if (values[k]) u.set(k, values[k]);
    for (const [k, v] of new URLSearchParams(moreFilters)) u.set(k, v);
    if (area) u.set("area", area);
    const qs = u.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [ready, debouncedQ, sector, city, minRev, maxRev, naics, lender, moreFilters, area, sort, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setProfile(null);
      requestAnimationFrame(() => panel.current?.scrollTo({ top: listScroll.current }));
      return;
    }
    // The business and its own records first (fast), then comparables, banks and locations.
    const ctrl = new AbortController();
    const card = data?.results.find((b) => Number(b.id) === selectedId);
    fetch(`/api/businesses/${selectedId}?core=1`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        setProfile(p);
        if (!p) { setSelectedId(null); return; }
        return fetch(`/api/businesses/${selectedId}/related${card && !card.locations ? "?locations=0" : ""}`, { signal: ctrl.signal })
          .then((r) => (r.ok ? r.json() : null))
          .then((rel) => rel && setProfile((cur) => (cur && Number(cur.id) === selectedId ? { ...cur, ...rel } : cur)));
      })
      .catch(() => {});
    panel.current?.scrollTo({ top: 0 });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Hovering a card for a moment loads its profile into the browser's cache, so a click opens it at once.
  useEffect(() => {
    if (!hovered || hovered === selectedId) return;
    const t = setTimeout(() => { fetch(`/api/businesses/${hovered}?core=1`).catch(() => {}); }, 150);
    return () => clearTimeout(t);
  }, [hovered, selectedId]);

  const selectedPoint = useMemo(
    () => (profile?.lat != null ? { lat: Number(profile.lat), lon: Number(profile.lon) } : null),
    [profile],
  );

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 200);
    return () => clearTimeout(t);
  }, [q]);

  // A bank's borrowers are spread across the state, so a lender filter also searches statewide.
  const fitKey = city || debouncedQ || lender || area ? `${city}|${debouncedQ}|${lender}|${area}` : "";

  // Strings, not objects, so a render that changes nothing never repeats a request.
  const filterParams = useMemo(() => {
    const p = new URLSearchParams();
    if (debouncedQ) p.set("q", debouncedQ);
    if (sector) p.set("sector", sector);
    if (city) p.set("city", city);
    if (minRev) p.set("min_rev", minRev);
    if (maxRev) p.set("max_rev", maxRev);
    if (naics) p.set("naics", naics);
    if (lender) p.set("lender", lender);
    for (const [k, v] of new URLSearchParams(moreFilters)) p.set(k, v);
    if (area) p.set("area", area);
    return p.toString();
  }, [debouncedQ, sector, city, minRev, maxRev, naics, lender, moreFilters, area]);
  // A city or name search covers the whole state; the map then flies to the matches.
  const fmtBox = (b: Box) => b.map((n) => n.toFixed(4)).join(",");
  const params = useMemo(() => {
    const p = new URLSearchParams(filterParams);
    if (bbox && !fitKey) p.set("bbox", fmtBox(bbox));
    return p.toString();
  }, [filterParams, bbox, fitKey]);

  // Widen the pin area only when the view leaves it, or when a capped result may be hiding pins.
  useEffect(() => {
    if (!bbox || fitKey) { setPinArea(null); return; }
    setPinArea((area) => (area && inside(bbox, area) && !pinsCapped.current ? area : padBox(bbox)));
  }, [bbox, fitKey]);
  const pinParams = useMemo(() => {
    const p = new URLSearchParams(filterParams);
    if (pinArea && !fitKey) p.set("bbox", fmtBox(pinArea));
    return p.toString();
  }, [filterParams, pinArea, fitKey]);

  const listKey = `${params}&sort=${sort}`;
  // Typed but not yet searched, or a new search/filter on its way: say so, and dim the old results.
  const typing = q.trim() !== debouncedQ.trim();
  const updating = typing || (loading && !!data && data.key !== listKey);
  const offset = more.key === listKey ? more.offset : 0;

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
        .then((d) => {
          if (offset === 0) {
            setData({ ...d, key: listKey, q: debouncedQ });
            panel.current?.scrollTo({ top: 0 });
          } else {
            // Next batch: append to the same search's list.
            setData((prev) => (prev && prev.key === listKey
              ? { ...prev, total: d.total, capped: d.capped, approx: d.approx, results: [...prev.results, ...d.results] } : prev));
          }
          setLoading(false);
        })
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, listKey, offset, attempt]);

  // Load the next batch when the bottom of the list comes within a screen of view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !data || data.key !== listKey || loading || failed || data.results.length >= data.total) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) setMore({ key: listKey, offset: data.results.length });
    }, { root: panel.current, rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [data, listKey, loading, failed]);

  useEffect(() => {
    if (!ready) return;
    const ctrl = new AbortController();
    // A new search clears the map, so it never flies to the previous search's pins; panning and
    // zooming keep the current pins up until the new ones arrive.
    if (pinsFitKey.current !== fitKey) setPoints(null);
    setPinsLoading(true);
    fetch(`/api/points?${pinParams}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setPinsLoading(false);
        if (!d) return;
        pinsCapped.current = d.features.length >= PIN_LIMIT;
        pinsFitKey.current = fitKey;
        setPoints(d);
      })
      .catch(() => { if (!ctrl.signal.aborted) setPinsLoading(false); });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pinParams, attempt]);

  const anyFilter = debouncedQ || sector || city || minRev || maxRev;
  const total = data?.total ?? 0;
  // Past 5,000 the server stops counting (it took seconds for a whole city): "5,000+".
  // A big map view's total comes from the per-square counts: "about 37,500".
  const totalText = data?.approx ? `about ${(Math.round(data.approx / 100) * 100).toLocaleString()}`
    : `${total.toLocaleString()}${data?.capped ? "+" : ""}`;

  return (
    <>
      <div className="toolbar">
        {/* Suggestions are the top of the list query, so typing costs one request, not two. */}
        <SearchBox value={q} onChange={setQ} onPick={openBusiness} busy={updating && !!q}
          suggestions={data && data.q
            ? { q: data.q, items: data.results.slice(0, 6), industry: data.industry, total: data.total, capped: data.capped } : null} />
        <FilterBar value={filters} cities={cities} onChange={(next) => setFilters((f) => ({ ...f, ...next }))} />
      </div>
      <div className="explorer" data-view={view}>
        <div className="map">
          <Map points={points} loading={pinsLoading} onBoundsChange={setBbox} fitKey={fitKey} onSelect={openBusiness}
            selected={selectedPoint} hoveredId={hovered} onHover={setHovered}
            area={areaPts} onArea={(pts) => setArea(pts ? pts.map((p) => p.join(",")).join(";") : "")} />
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
                : (() => {
                    // The card's name and place straight away, while the details load.
                    const card = data?.results.find((x) => Number(x.id) === selectedId);
                    return (
                      <div className="profile-loading">
                        {card && <><h2>{card.name}</h2><div className="sub">{card.city}, OK · {card.industry}</div></>}
                        <div className="loading-more"><span className="spinner" aria-hidden /> Loading details…</div>
                        <div className="cards"><div className="skeleton" style={{ height: 90 }} /><div className="skeleton" style={{ height: 220 }} /></div>
                      </div>
                    );
                  })()}
            </div>
          )}
          {/* The list stays mounted while a profile is open, so Back returns to the same scroll position. */}
          <div style={{ display: selectedId ? "none" : undefined }}>
            <div className="list-head">
              {(updating || !data) && !failed && <div className="progress" aria-hidden />}
              <span className="count" aria-live="polite">
                {failed ? "Couldn't load businesses"
                  : updating ? <><span className="spinner" aria-hidden /> {q ? "Searching…" : "Updating…"}</>
                  : data ? `${totalText} ${total === 1 ? "business" : "businesses"}` : <><span className="spinner" aria-hidden /> Loading businesses…</>}
              </span>
              <span className="sub">
                {data?.industry ? <>Industry: <strong>{data.industry}</strong></> : fitKey ? "matching your search" : "in map view"} · estimates
              </span>
              <span className="list-actions">
                <a href={`/api/export?${params}&sort=${sort}`} download>Export CSV</a>
                <button className="link-btn" onClick={() => {
                  const label = [debouncedQ, sector, city].filter(Boolean).join(" · ") || "All businesses";
                  saveSearch({ label, query: new URLSearchParams(filterParams + (sort !== "revenue_desc" ? `&sort=${sort}` : "")).toString() });
                  setSavedNote(true); setTimeout(() => setSavedNote(false), 2000);
                }}>{savedNote ? "Saved ✓" : "Save search"}</button>
              </span>
            </div>
            {failed && !data?.results.length && (
              <div className="empty">
                <h3>Something went wrong loading businesses</h3>
                <p>The database may be busy. Try again in a moment.</p>
                <button className="btn primary" onClick={() => setAttempt((a) => a + 1)}>Retry</button>
              </div>
            )}
            <div className={`cards ${updating ? "stale" : ""}`} aria-busy={loading}>
              {!data && !failed && Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton" />)}
              {data?.results.map((b) => (
                <BizCard key={b.id} b={b} hovered={hovered === Number(b.id)} onOpen={openBusiness} onHover={setHovered} />
              ))}
            </div>
            {data && total === 0 && !updating && (
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
            {/* Continuous scroll: reaching this loads the next batch. */}
            <div ref={sentinel} />
            {data && data.results.length > 0 && (
              <div className="list-end">
                {failed ? (
                  <button className="btn" onClick={() => setAttempt((a) => a + 1)}>Couldn&apos;t load more. Retry</button>
                ) : data.results.length < total ? (
                  <span><span className="spinner" aria-hidden /> Loading more… ({data.results.length.toLocaleString()} of {totalText})</span>
                ) : data.capped ? (
                  <span>First {total.toLocaleString()} shown. Zoom in or add a filter to see the rest.</span>
                ) : total > PAGE ? (
                  <span>All {total.toLocaleString()} shown</span>
                ) : null}
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
