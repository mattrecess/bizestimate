"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { SECTORS } from "@/lib/sectors";
import { money, moneyRange } from "@/lib/format";

const Map = dynamic(() => import("@/components/Map"), { ssr: false });
const PAGE = 50;

type Biz = {
  id: number; name: string; address: string | null; city: string; zip: string; industry: string;
  jobs_reported: number | null; est_revenue_low: string; est_revenue_mid: string; est_revenue_high: string;
  est_ebitda_mid: string; est_confidence: string;
};

export default function Home() {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [sector, setSector] = useState("");
  const [minRev, setMinRev] = useState("");
  const [maxRev, setMaxRev] = useState("");
  const [sort, setSort] = useState("revenue_desc");
  const [bbox, setBbox] = useState<[number, number, number, number] | null>(null);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ total: number; results: Biz[] } | null>(null);
  const [points, setPoints] = useState<GeoJSON.FeatureCollection | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (debouncedQ) p.set("q", debouncedQ);
    if (sector) p.set("sector", sector);
    if (minRev) p.set("min_rev", minRev);
    if (maxRev) p.set("max_rev", maxRev);
    if (bbox) p.set("bbox", bbox.map((n) => n.toFixed(4)).join(","));
    return p;
  }, [debouncedQ, sector, minRev, maxRev, bbox]);

  useEffect(() => setOffset(0), [params, sort]);

  useEffect(() => {
    const ctrl = new AbortController();
    const p = new URLSearchParams(params);
    p.set("sort", sort); p.set("limit", String(PAGE)); p.set("offset", String(offset));
    fetch(`/api/businesses?${p}`, { signal: ctrl.signal }).then((r) => r.json()).then(setData).catch(() => {});
    return () => ctrl.abort();
  }, [params, sort, offset]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/points?${params}`, { signal: ctrl.signal }).then((r) => r.json()).then(setPoints).catch(() => {});
    return () => ctrl.abort();
  }, [params]);

  return (
    <>
      <div className="filters">
        <input type="search" placeholder="Search business name, city or industry" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={sector} onChange={(e) => setSector(e.target.value)}>
          <option value="">All industries</option>
          {SECTORS.map((s) => <option key={s.label}>{s.label}</option>)}
        </select>
        <select value={minRev} onChange={(e) => setMinRev(e.target.value)}>
          <option value="">Min revenue</option>
          {[250e3, 500e3, 1e6, 2e6, 5e6, 10e6, 25e6].map((v) => <option key={v} value={v}>{money(v)}+</option>)}
        </select>
        <select value={maxRev} onChange={(e) => setMaxRev(e.target.value)}>
          <option value="">Max revenue</option>
          {[500e3, 1e6, 2e6, 5e6, 10e6, 25e6, 50e6].map((v) => <option key={v} value={v}>up to {money(v)}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="revenue_desc">Revenue: high to low</option>
          <option value="revenue_asc">Revenue: low to high</option>
          <option value="ebitda_desc">EBITDA: high to low</option>
          <option value="jobs_desc">Employees: most</option>
          <option value="name">Name A–Z</option>
        </select>
      </div>
      <div className="explorer">
        <div className="map"><Map points={points} onBoundsChange={setBbox} /></div>
        <div className="list">
          <div className="meta">
            <span>{data ? `${data.total.toLocaleString()} businesses in view` : "Loading…"}</span>
            <span>Estimates</span>
          </div>
          {data?.results.map((b) => (
            <Link key={b.id} href={`/business/${b.id}`} className="card">
              <div className="name">{b.name}</div>
              <div className="sub">{b.industry} · {b.city}, OK {b.zip}{b.jobs_reported ? ` · ${b.jobs_reported} employee${b.jobs_reported === 1 ? "" : "s"}` : ""}</div>
              <div className="nums">
                <div className="num"><div className="k">Revenue</div><div className="v">{money(b.est_revenue_mid)}</div></div>
                <div className="num"><div className="k">EBITDA</div><div className="v">{money(b.est_ebitda_mid)}</div></div>
                <div className="num"><div className="k">Range</div><div className="v" style={{ fontWeight: 400 }}>{moneyRange(b.est_revenue_low, b.est_revenue_high)}</div></div>
              </div>
            </Link>
          ))}
          {data && data.total > PAGE && (
            <div className="pager">
              <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
              <span style={{ color: "var(--muted)", alignSelf: "center" }}>{offset + 1}–{Math.min(offset + PAGE, data.total)}</span>
              <button disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>Next</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
