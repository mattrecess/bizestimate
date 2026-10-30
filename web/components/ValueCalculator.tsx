"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { money, parseDollars } from "@/lib/format";
import { blurOnEnter } from "@/lib/touch";
import { SIZE, sizeMultiple } from "@/lib/valuation";

// factor: the industry's adjustment to the size multiple; margins: typical EBITDA margin at $1M, $5M and $20M revenue.
export type CalcIndustry = { label: string; slug: string; factor: number; margins: number[] };

const OTHER: CalcIndustry = { label: "Other / not listed", slug: "", factor: 1, margins: [0.1, 0.1, 0.1] };

// Margin for a revenue, read along the $1M / $5M / $20M points (on a log scale), flat past either end.
function typicalMargin(ind: CalcIndustry, revenue: number) {
  const pts = [1e6, 5e6, 2e7];
  if (revenue <= pts[0]) return ind.margins[0];
  if (revenue >= pts[2]) return ind.margins[2];
  const i = revenue < pts[1] ? 0 : 1;
  const t = Math.log(revenue / pts[i]) / Math.log(pts[i + 1] / pts[i]);
  return ind.margins[i] + t * (ind.margins[i + 1] - ind.margins[i]);
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

export default function ValueCalculator({ industries, initial }: {
  industries: CalcIndustry[]; initial: { industry: string; revenue: string; ebitda: string };
}) {
  const [industry, setIndustry] = useState(initial.industry);
  const [revenueText, setRevenueText] = useState(initial.revenue);
  const [ebitdaText, setEbitdaText] = useState(initial.ebitda);

  // Keep the answer in the address, so it can be bookmarked or sent to a partner.
  useEffect(() => {
    const p = new URLSearchParams();
    if (industry) p.set("industry", industry);
    if (revenueText) p.set("revenue", revenueText);
    if (ebitdaText) p.set("ebitda", ebitdaText);
    window.history.replaceState(null, "", p.size ? `?${p}` : window.location.pathname);
  }, [industry, revenueText, ebitdaText]);

  const ind = industries.find((i) => i.slug === industry) ?? OTHER;
  const revenue = parseDollars(revenueText);
  const given = parseDollars(ebitdaText);

  const result = useMemo(() => {
    const margin = revenue ? typicalMargin(ind, revenue) : null;
    const ebitda = given ?? (revenue && margin ? revenue * margin : null);
    if (!ebitda || ebitda <= 0) return null;
    const multiple = round1(sizeMultiple(ebitda) * ind.factor);
    // A typical margin is a guess at your profit too, so its range is wider.
    const spread = given ? 1 : 1.25;
    const next = SIZE.find(([floor]) => floor > ebitda);
    return {
      ebitda, multiple, margin, estimated: !given,
      mid: ebitda * multiple, low: (ebitda / spread) * multiple * 0.8, high: ebitda * spread * multiple * 1.2,
      next: next && next[0] <= ebitda * 3 ? { ebitda: next[0], multiple: round1(next[1] * ind.factor) } : null,
    };
  }, [ind, revenue, given]);

  const badRevenue = revenueText.trim() !== "" && revenue == null;
  const badEbitda = ebitdaText.trim() !== "" && given == null;

  return (
    <div className="calc">
      <form className="calc-form" onSubmit={(e) => { e.preventDefault(); (document.activeElement as HTMLElement | null)?.blur(); }}>
        <label>Industry
          <select value={industry} onChange={(e) => setIndustry(e.target.value)}>
            <option value="">Choose your industry…</option>
            {industries.map((i) => <option key={i.slug} value={i.slug}>{i.label}</option>)}
            <option value="other">{OTHER.label}</option>
          </select>
        </label>
        <label>Annual revenue
          <input value={revenueText} onChange={(e) => setRevenueText(e.target.value)} placeholder="e.g. $4.2M"
            inputMode="decimal" enterKeyHint="next" onKeyDown={blurOnEnter} aria-invalid={badRevenue} />
          {badRevenue && <span className="calc-err">Try a number like 4200000, $4.2M or 850k</span>}
        </label>
        <label><span>EBITDA <span className="calc-opt">(optional)</span></span>
          <input value={ebitdaText} onChange={(e) => setEbitdaText(e.target.value)} placeholder="Profit before interest, taxes, depreciation"
            inputMode="decimal" enterKeyHint="done" onKeyDown={blurOnEnter} aria-invalid={badEbitda} />
          {badEbitda ? <span className="calc-err">Try a number like 650000 or $650k</span>
            : <span className="calc-hint">Net profit plus interest, taxes, depreciation, amortization and owner pay above a market salary.</span>}
        </label>
      </form>

      <div className="calc-out" aria-live="polite">
        {!result ? (
          <p className="calc-empty">Enter your revenue{industry ? "" : " and industry"} to see an estimate.</p>
        ) : (
          <>
            <div className="calc-k">Estimated value</div>
            <div className="calc-v">{money(result.mid)}</div>
            <div className="calc-r">Likely range {money(result.low)} – {money(result.high)}</div>
            <dl className="calc-math">
              <div><dt>EBITDA</dt><dd>{money(result.ebitda)}{result.estimated && result.margin ? <span> (typical {pct(result.margin)} margin)</span> : null}</dd></div>
              <div><dt>Multiple</dt><dd>{result.multiple}×</dd></div>
              <div><dt>Value</dt><dd>{money(result.ebitda)} × {result.multiple} = {money(result.mid)}</dd></div>
            </dl>
            <p className="calc-note">
              {result.multiple}× is about what buyers pay for a {ind === OTHER ? "private" : ind.label.toLowerCase()} company
              with {money(result.ebitda)} of EBITDA.
              {result.estimated && " Adding your own EBITDA narrows the range."}
              {result.next && <> Growing EBITDA to {money(result.next.ebitda)} would typically lift the multiple
                to {result.next.multiple}×, a value near {money(result.next.ebitda * result.next.multiple)}.</>}
            </p>
            {ind.slug && <p className="calc-note"><Link href={`/oklahoma/${ind.slug}`}>See what Oklahoma {ind.label.toLowerCase()} businesses are worth →</Link></p>}
          </>
        )}
      </div>
    </div>
  );
}
