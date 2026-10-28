"use client";
import { useEffect, useRef, useState } from "react";
import { money } from "@/lib/format";

// Consumer prices (CPI-U annual averages, as in etl/adjust.py): past values are shown in that year's dollars.
const CPI: Record<number, number> = { 2017: 245.1, 2018: 251.1, 2019: 255.7, 2020: 258.8, 2021: 271.0, 2022: 292.7, 2023: 304.7, 2024: 313.7, 2025: 322.0 };
const cpi = (y: number) => CPI[y] ?? CPI[Math.max(...Object.keys(CPI).map(Number))];

export type ValuePoint = { year: number; value: number; label: string };

/** Estimated value by year: today's estimate scaled back by the headcount and prices of earlier
 *  years (PPP application, then each 401(k) filing). Null when there's no history to show. */
export function valueHistory(opts: {
  valueNow: number | null; employeesNow: number | null; ppp: { year: number; employees: number } | null;
  plan: { year: number; employees: number }[];
}): ValuePoint[] | null {
  const { valueNow, employeesNow, ppp, plan } = opts;
  if (!valueNow || !employeesNow) return null;
  const nowYear = new Date().getFullYear();
  const pts: ValuePoint[] = [];
  const at = (year: number, employees: number, label: string) =>
    pts.push({ year, value: valueNow * (employees / employeesNow) * (cpi(year) / cpi(nowYear)), label });
  if (ppp) at(ppp.year, ppp.employees, "PPP application");
  for (const p of plan) if (p.year < nowYear && !(ppp && p.year === ppp.year)) at(p.year, p.employees, "401(k) filing");
  pts.sort((a, b) => a.year - b.year);
  pts.push({ year: nowYear, value: valueNow, label: "Today's estimate" });
  return pts.length >= 2 ? pts : null;
}

const H = 170, PAD = { l: 52, r: 16, t: 14, b: 26 };

export default function ValueChart({ points }: { points: ValuePoint[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(560);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  const first = points[0], last = points[points.length - 1];
  const minY = first.year, maxY = Math.max(last.year, minY + 1);
  const top = Math.max(...points.map((p) => p.value)) * 1.15;
  const x = (y: number) => PAD.l + ((y - minY) / (maxY - minY)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - v / top) * (H - PAD.t - PAD.b);
  const change = first.value ? last.value / first.value - 1 : 0;
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(p.year)},${y(p.value)}`).join(" ");
  const h = hover == null ? null : points[hover];
  return (
    <div className="section headcount">
      <div className="hc-head">
        <h2>Estimated value over time</h2>
        <span className={`badge ${change >= 0 ? "good" : "warn"}`}>{change >= 0 ? "▲" : "▼"} {Math.abs(change * 100).toFixed(0)}% since {first.year}</span>
      </div>
      <div className="hc-plot" ref={box}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Estimated value from ${money(first.value)} in ${first.year} to ${money(last.value)} today`}
          onPointerLeave={() => setHover(null)}>
          {[0, top / 2, top].map((t) => (
            <g key={t}>
              <line className="hc-grid" x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
              <text className="hc-axis" x={PAD.l - 6} y={y(t) + 4} textAnchor="end">{money(t)}</text>
            </g>
          ))}
          {points.map((p) => <text key={p.year} className="hc-axis" x={x(p.year)} y={H - 6} textAnchor="middle">{p.year}</text>)}
          <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2.5} />
          {points.map((p, i) => (
            <circle key={p.year} cx={x(p.year)} cy={y(p.value)} r={hover === i ? 6 : 4.5} fill={i === points.length - 1 ? "var(--accent)" : "var(--panel)"}
              stroke="var(--accent)" strokeWidth={2} onPointerEnter={() => setHover(i)} />
          ))}
          {h && (
            <text className="hc-axis" x={Math.min(Math.max(x(h.year), PAD.l + 60), W - 70)} y={Math.max(y(h.value) - 12, 12)} textAnchor="middle"
              style={{ fontWeight: 650, fill: "var(--text)" }}>{h.year}: {money(h.value)} · {h.label}</text>
          )}
        </svg>
      </div>
      <p className="disclaimer">Today&apos;s estimate scaled by the headcount reported each year and that year&apos;s prices. A trend, not a
        record of past sale values.</p>
    </div>
  );
}
