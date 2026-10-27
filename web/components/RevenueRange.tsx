"use client";
import { useEffect, useState } from "react";
import { money } from "@/lib/format";
import { REVENUE_STEPS } from "@/lib/revenue-steps";

const LAST = REVENUE_STEPS.length - 1;
const stepOf = (v: string, fallback: number) => {
  if (!v) return fallback;
  const i = REVENUE_STEPS.findIndex((s) => s >= Number(v));
  return i < 0 ? LAST : i;
};
const label = (i: number, end: "min" | "max") =>
  end === "min" ? (i === 0 ? "No min" : money(REVENUE_STEPS[i])) : (i === LAST ? "No max" : money(REVENUE_STEPS[i]));

// Zillow-style price range: a histogram of businesses by revenue, a two-handle slider over it, and
// Minimum / Maximum boxes. The list updates when a handle is let go.
export default function RevenueRange({ minRev, maxRev, onChange }: {
  minRev: string; maxRev: string; onChange: (next: { minRev: string; maxRev: string }) => void;
}) {
  const [lo, setLo] = useState(stepOf(minRev, 0));
  const [hi, setHi] = useState(stepOf(maxRev, LAST));
  const [hist, setHist] = useState<number[] | null>(null);
  useEffect(() => { setLo(stepOf(minRev, 0)); setHi(stepOf(maxRev, LAST)); }, [minRev, maxRev]);
  useEffect(() => { fetch("/api/revenue-histogram").then((r) => r.json()).then(setHist).catch(() => {}); }, []);

  const commit = (a = lo, b = hi) => onChange({ minRev: a === 0 ? "" : String(REVENUE_STEPS[a]), maxRev: b === LAST ? "" : String(REVENUE_STEPS[b]) });
  const peak = Math.max(1, ...(hist ?? [1]));
  const pct = (i: number) => (i / LAST) * 100;
  const select = (end: "min" | "max", value: number) => {
    const a = end === "min" ? Math.min(value, hi - 1) : lo;
    const b = end === "max" ? Math.max(value, lo + 1) : hi;
    setLo(a); setHi(b); commit(a, b);
  };

  return (
    <div className="rev-range">
      <div className="histogram" aria-hidden>
        {/* Bar i: businesses between step i and step i+1 (histogram bucket i); the last bar also holds
            everything above the top step. */}
        {Array.from({ length: LAST }, (_, i) => {
          const n = hist ? (hist[i] ?? 0) + (i === LAST - 1 ? (hist[LAST] ?? 0) : 0) : 0;
          return <span key={i} className={i >= lo && i < hi ? "in" : ""} style={{ height: `${Math.max(4, (Math.sqrt(n) / Math.sqrt(peak)) * 100)}%` }} />;
        })}
      </div>
      <div className="dual-slider">
        <div className="track" />
        <div className="track active" style={{ left: `${pct(lo)}%`, right: `${100 - pct(hi)}%` }} />
        <input type="range" min={0} max={LAST} step={1} value={lo} aria-label="Minimum revenue"
          onChange={(e) => setLo(Math.min(Number(e.target.value), hi - 1))} onPointerUp={() => commit()} onKeyUp={() => commit()} />
        <input type="range" min={0} max={LAST} step={1} value={hi} aria-label="Maximum revenue"
          onChange={(e) => setHi(Math.max(Number(e.target.value), lo + 1))} onPointerUp={() => commit()} onKeyUp={() => commit()} />
      </div>
      <div className="range-boxes">
        <label>Minimum
          <select value={lo} onChange={(e) => select("min", Number(e.target.value))}>
            {REVENUE_STEPS.slice(0, LAST).map((_, i) => <option key={i} value={i}>{label(i, "min")}</option>)}
          </select>
        </label>
        <span className="dash">–</span>
        <label>Maximum
          <select value={hi} onChange={(e) => select("max", Number(e.target.value))}>
            {REVENUE_STEPS.map((_, i) => i > 0 && <option key={i} value={i}>{label(i, "max")}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}
