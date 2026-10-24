// Rough enterprise value: EBITDA x a typical sale multiple for a company of that size, adjusted
// for its industry. Multiples rise with size (small owner-run firms sell for 2-3x, $10M+ EBITDA
// companies for 7x+), following the published averages of business-broker and private-equity deal
// surveys (BizBuySell Insight, Pepperdine Private Capital Markets, GF Data). A rough guide only.

type Num = string | number | null | undefined;

// EBITDA floor of each band -> typical multiple.
const SIZE: [number, number][] = [
  [0, 2.5], [250e3, 3.0], [500e3, 3.75], [1e6, 4.5], [2e6, 5.5], [5e6, 6.5], [10e6, 7.5], [25e6, 8.5],
];

// Industry adjustments by NAICS prefix (longest wins): recurring-revenue and specialist businesses
// sell for more, project-based and commodity ones for less.
const INDUSTRY: [string, number][] = [
  ["5415", 1.3], ["5182", 1.3], ["5132", 1.35], ["5242", 1.3], ["562", 1.15], ["6212", 1.2], ["6211", 1.1],
  ["6213", 1.1], ["6216", 1.15], ["5412", 1.15], ["5411", 0.95], ["5413", 1.0], ["238220", 1.05],
  ["238210", 1.0], ["5617", 0.95], ["561720", 0.9], ["23", 0.85], ["31", 1.05], ["32", 1.05], ["33", 1.1],
  ["42", 0.95], ["44", 0.8], ["45", 0.8], ["7225", 0.7], ["7224", 0.75], ["721", 0.9], ["484", 0.8],
  ["211", 0.8], ["213", 0.75], ["8111", 0.9], ["812", 0.85], ["54", 1.0], ["62", 1.05],
];

export type Valuation = { low: number; mid: number; high: number; multiple: number };

function multipleFor(naics: string | null | undefined, ebitda: number) {
  let size = SIZE[0][1];
  for (const [floor, m] of SIZE) if (ebitda >= floor) size = m;
  let adj = 1;
  let len = 0;
  for (const [prefix, f] of INDUSTRY) {
    if (naics?.startsWith(prefix) && prefix.length > len) { adj = f; len = prefix.length; }
  }
  return Math.round(size * adj * 10) / 10;
}

/** Null when a sale value doesn't apply: nonprofits, banks, public companies, or no positive EBITDA. */
export function estimateValue(b: {
  naics?: string | null; est_ebitda_low?: Num; est_ebitda_mid?: Num; est_ebitda_high?: Num;
  is_nonprofit?: boolean | null; est_method?: string | null; public_company?: boolean;
}): Valuation | null {
  const mid = Number(b.est_ebitda_mid);
  if (!Number.isFinite(mid) || mid <= 0 || b.is_nonprofit || b.public_company) return null;
  if (b.naics?.startsWith("5221") || b.naics?.startsWith("813")) return null;
  const multiple = multipleFor(b.naics, mid);
  const low = Number(b.est_ebitda_low) || mid * 0.8;
  const high = Number(b.est_ebitda_high) || mid * 1.2;
  // Wider than the EBITDA range: the multiple itself varies a turn or two either way.
  return { low: low * multiple * 0.8, mid: mid * multiple, high: high * multiple * 1.2, multiple };
}
