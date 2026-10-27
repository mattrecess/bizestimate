// The "More" filters, kept together as one query string ("min_value=1000000&owner=1") in the page
// state and URL. Keys match parseFilters in lib/queries.ts.
export const MORE_KEYS = ["min_value", "max_value", "min_ebitda", "max_ebitda", "min_emp", "max_emp", "sell", "years",
  "owner", "phone", "email", "website", "contractor", "basis", "x_branch", "x_nonprofit", "x_franchise"] as const;

export const moreFrom = (u: URLSearchParams) => {
  const p = new URLSearchParams();
  for (const k of MORE_KEYS) if (u.get(k)) p.set(k, u.get(k)!);
  return p.toString();
};

// Number of filters set, for the button's badge (a min/max pair counts once).
export function moreCount(more: string) {
  const p = new URLSearchParams(more);
  const pairs = [["min_value", "max_value"], ["min_ebitda", "max_ebitda"], ["min_emp", "max_emp"]];
  let n = pairs.filter(([a, b]) => p.get(a) || p.get(b)).length;
  for (const k of MORE_KEYS) if (p.get(k) && !pairs.flat().includes(k)) n++;
  return n;
}
