export function money(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

export function moneyRange(lo: unknown, hi: unknown): string {
  return `${money(lo as number)} – ${money(hi as number)}`;
}

// "$4.2M", "4,200,000", "4.2 million", "850k" -> dollars; null when it isn't a number.
export function parseDollars(v: string) {
  const s = v.toLowerCase().replace(/[$,\s]/g, "");
  const m = s.match(/^(\d+(?:\.\d+)?)(k|m|mm|million|b|billion)?$/);
  if (!m) return null;
  const mult = { k: 1e3, m: 1e6, mm: 1e6, million: 1e6, b: 1e9, billion: 1e9 }[m[2] as "k"] ?? 1;
  return Math.round(Number(m[1]) * mult);
}
