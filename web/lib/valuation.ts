// Rough enterprise value: EBITDA x a typical sale multiple for a company of that size, adjusted
// for its industry. Multiples rise with size (small owner-run firms sell for 2-3x, $10M+ EBITDA
// companies for 7x+), following the published averages of business-broker and private-equity deal
// surveys (BizBuySell Insight, Pepperdine Private Capital Markets, GF Data). A rough guide only.
// Checked against 2026 figures: BizBuySell main-street sales ~2.6-2.7x SDE (owner's earnings, so a
// higher multiple of EBITDA); GF Data's $10-25M enterprise-value deals ~5.9x and PE deals overall ~7x.
// Sales the admin records (/admin) show actual vs. modelled multiples, to tune these over time.

type Num = string | number | null | undefined;

// EBITDA floor of each band -> typical multiple.
export const SIZE: [number, number][] = [
  [0, 2.5], [250e3, 3.0], [500e3, 3.75], [1e6, 4.5], [2e6, 5.5], [5e6, 6.5], [10e6, 7.5], [25e6, 8.5],
];

// Industry adjustments by NAICS prefix (longest wins), relative to the typical small private company.
// Rebuilt Oct 2026 from First Page Sage's meta-analysis of private M&A deals by industry and size
// (Jan 2025 report, deals Q3 2022-Q1 2025): each industry's average multiple over the all-industry
// median in the $0-1M and $1-3M EBITDA bands, pulled part-way toward 1 where those deal samples are
// thin. Damodaran's US EV/EBITDA by sector (Jan 2026; public companies) was used only to check the
// ranking. Industries neither covers (retail, restaurants, wholesale, personal and building services)
// keep the broker-survey adjustments used before.
export const INDUSTRY: [string, number][] = [
  // From the deal data
  ["23", 0.75], ["238210", 0.8], ["238220", 0.8], ["5413", 1.15], ["31", 1.0], ["32", 1.0], ["33", 1.05],
  ["3254", 1.5], ["3364", 1.4], ["211", 0.85], ["213", 0.8], ["48", 1.0], ["484", 0.85], ["488", 1.05],
  ["492", 1.05], ["62", 1.0], ["6211", 1.1], ["6212", 1.2], ["6213", 1.0], ["6216", 1.15], ["5613", 1.0],
  ["5411", 0.75], ["523", 0.75], ["5242", 1.2], ["5415", 1.2], ["5182", 1.2], ["5132", 1.1], ["541511", 1.0],
  ["531", 0.8], ["562", 1.05], ["721", 1.3], ["71", 0.9], ["611", 1.05],
  // Broker-survey adjustments (no deal-data coverage)
  ["5412", 1.15], ["5617", 0.95], ["561720", 0.9], ["42", 0.95], ["44", 0.8], ["45", 0.8], ["7225", 0.7],
  ["7224", 0.75], ["811192", 1.3], ["8111", 0.9], ["812", 0.85], ["54", 1.0],
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
