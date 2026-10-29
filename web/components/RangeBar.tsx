import { money } from "@/lib/format";

type Num = string | number | null | undefined;

// Low / estimate / high on one bar, with the estimate's position marked.
export default function RangeBar({ low, mid, high }: { low: Num; mid: Num; high: Num }) {
  const lo = Number(low), m = Number(mid), hi = Number(high);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null;
  const pct = Math.min(100, Math.max(0, ((m - lo) / (hi - lo)) * 100));
  return (
    <div className="range" aria-label={`Range ${money(lo)} to ${money(hi)}, estimate ${money(m)}`}>
      <div className="range-track"><div className="range-dot" style={{ left: `${pct}%` }} /></div>
      <div className="range-labels"><span>{money(lo)}</span><span className="range-hi">up to {money(hi)}</span></div>
    </div>
  );
}
