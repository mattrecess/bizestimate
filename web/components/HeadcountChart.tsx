"use client";
import { useEffect, useRef, useState } from "react";
import { money } from "@/lib/format";

type Num = string | number | null;
export type Headcount = { year: number; employees: number };
type Point = { year: number; employees: number; source: "ppp" | "plan" };

const H = 190, PAD = { l: 40, r: 16, t: 14, b: 26 };

// Employees by year: PPP's reported headcount (2020/21) then retirement-plan participants from
// Form 5500 filings. One line; the PPP point is hollow and its segment dashed (different source).
export default function HeadcountChart({ ppp, plan, revenuePerEmployee, ebitdaMargin }: {
  ppp: { year: number; employees: number } | null;
  plan: Headcount[];
  revenuePerEmployee: Num;
  ebitdaMargin: Num;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // Drawn at its real pixel width, so labels stay legible on phones instead of shrinking.
  const [W, setW] = useState(560);
  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, [plan.length]);
  if (!plan.length) return null;

  const planPts: Point[] = plan.map((p) => ({ ...p, source: "plan" }));
  const pppPt: Point | null = ppp ? { ...ppp, source: "ppp" } : null;
  const all = [...(pppPt ? [pppPt] : []), ...planPts];
  const years = [...new Set(all.map((p) => p.year))].sort((a, b) => a - b);
  const minYear = years[0], maxYear = Math.max(years[years.length - 1], minYear + 1);
  const maxN = Math.max(...all.map((p) => p.employees));
  const top = niceCeil(maxN * 1.1);
  const x = (y: number) => PAD.l + ((y - minYear) / (maxYear - minYear)) * (W - PAD.l - PAD.r);
  const yPos = (n: number) => PAD.t + (1 - n / top) * (H - PAD.t - PAD.b);
  const ticks = [0, Math.round(top / 2), top];

  const rpe = Number(revenuePerEmployee) || 0;
  const margin = Number(ebitdaMargin) || 0;
  const first = pppPt ?? planPts[0];
  const last = planPts[planPts.length - 1];
  const change = first.employees ? (last.employees - first.employees) / first.employees : 0;
  const linkPpp = pppPt && pppPt.year < planPts[0].year;
  const planPath = planPts.map((p, i) => `${i ? "L" : "M"}${x(p.year)},${yPos(p.employees)}`).join(" ");

  function move(e: React.PointerEvent) {
    const r = svg.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    setHover(years.reduce((a, b) => (Math.abs(x(b) - px) < Math.abs(x(a) - px) ? b : a)));
  }

  const at = (year: number) => all.filter((p) => p.year === year);
  const hoverPts = hover == null ? [] : at(hover);

  return (
    <div className="section headcount">
      <div className="hc-head">
        <h2>Employees over time</h2>
        {last.year > first.year && (
          <span className={`badge ${change >= 0 ? "good" : "warn"}`}>
            {change >= 0 ? "▲" : "▼"} {Math.abs(change * 100).toFixed(0)}% since {first.year}
          </span>
        )}
      </div>
      <div className="hc-plot" ref={box}>
        <svg ref={svg} viewBox={`0 0 ${W} ${H}`} role="img"
          aria-label={`Employees from ${first.employees} in ${first.year} to ${last.employees} in ${last.year}`}
          onPointerMove={move} onPointerLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="hc-grid" x1={PAD.l} x2={W - PAD.r} y1={yPos(t)} y2={yPos(t)} />
              <text className="hc-axis" x={PAD.l - 6} y={yPos(t) + 4} textAnchor="end">{fmtCount(t)}</text>
            </g>
          ))}
          {years.map((y) => (
            <text key={y} className="hc-axis" x={x(y)} y={H - 6} textAnchor="middle">{y}</text>
          ))}
          {hover != null && <line className="hc-cross" x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} />}
          {linkPpp && (
            <line className="hc-line dashed" x1={x(pppPt!.year)} y1={yPos(pppPt!.employees)}
              x2={x(planPts[0].year)} y2={yPos(planPts[0].employees)} />
          )}
          <path className="hc-line" d={planPath} />
          {planPts.map((p) => (
            <circle key={p.year} className="hc-dot" cx={x(p.year)} cy={yPos(p.employees)} r={hover === p.year ? 5.5 : 4} />
          ))}
          {pppPt && (
            <circle className="hc-dot hollow" cx={x(pppPt.year)} cy={yPos(pppPt.employees)} r={hover === pppPt.year ? 5.5 : 4.5} />
          )}
          {/* Direct labels on the ends only. */}
          <text className="hc-label" x={x(first.year)} y={yPos(first.employees) - 10} textAnchor="start">{first.employees}</text>
          {last !== first && (
            <text className="hc-label" x={x(last.year)} y={yPos(last.employees) - 10} textAnchor="end">{last.employees}</text>
          )}
        </svg>
        {hover != null && hoverPts.length > 0 && (
          <div className="hc-tip" style={tipStyle(x(hover) / W)}>
            <div className="hc-tip-year">{hover}</div>
            {hoverPts.map((p) => (
              <div key={p.source}>
                <strong>{p.employees.toLocaleString()}</strong> {p.source === "ppp" ? "employees (PPP)" : "plan participants"}
                {rpe > 0 && <div className="hc-tip-sub">Revenue ≈ {money(p.employees * rpe)} · EBITDA ≈ {money(p.employees * rpe * margin)}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="hc-key">
        <span><i className="hc-key-line" />401(k) / retirement-plan participants</span>
        {pppPt && <span><i className="hc-key-dot" />Employees reported for PPP</span>}
      </div>
      <details className="hc-table">
        <summary>Show as table</summary>
        <table>
          <thead><tr><th>Year</th><th>Source</th><th className="num">Employees</th>{rpe > 0 && <><th className="num">Est. revenue</th><th className="num hide-sm">Est. EBITDA</th></>}</tr></thead>
          <tbody>
            {all.map((p) => (
              <tr key={`${p.source}${p.year}`}>
                <td>{p.year}</td><td>{p.source === "ppp" ? "PPP loan" : "Form 5500"}</td>
                <td className="num">{p.employees.toLocaleString()}</td>
                {rpe > 0 && <><td className="num">{money(p.employees * rpe)}</td><td className="num hide-sm">{money(p.employees * rpe * margin)}</td></>}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <p className="disclaimer">Participants are employees in the company&apos;s retirement plan at year end, from its
        Form 5500 filing with the Department of Labor. They usually run a little under total headcount (part-timers
        and new hires may not be eligible). Revenue and EBITDA apply this industry&apos;s revenue per employee
        and margin to each year&apos;s count.</p>
    </div>
  );
}

// Centred on the crosshair, but pinned inside the plot near either edge.
function tipStyle(f: number): React.CSSProperties {
  if (f < 0.25) return { left: `${f * 100}%`, transform: "translateX(-12px)" };
  if (f > 0.75) return { right: `${(1 - f) * 100}%`, transform: "translateX(12px)" };
  return { left: `${f * 100}%` };
}

function niceCeil(v: number) {
  if (v <= 0) return 10;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((c) => c >= v)!;
}

const fmtCount = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n % 1000 ? 1 : 0)}k` : String(Math.round(n)));
