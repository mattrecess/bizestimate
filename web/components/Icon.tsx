// Small inline icon set (stroke icons, 24-unit grid) so pages need no icon font or extra requests.
const PATHS: Record<string, string> = {
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.35-4.35",
  x: "M18 6 6 18M6 6l12 12",
  chevron: "m6 9 6 6 6-6",
  back: "M15 18l-6-6 6-6",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-9-9h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18",
  linkedin: "M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6ZM2 9h4v12H2zM4 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  share: "M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13",
  user: "M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z",
  external: "M14 3h7v7M10 14 21 3M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  map: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14",
  check: "m5 12 5 5L20 7",
  sliders: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M16 4v4M10 10v4M18 16v4",
  flame: "M12 22c4 0 7-3 7-7 0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-3 3-5 5-5 8 0 4 3 7 7 7Z",
  radar: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 12l6.4-6.4M12 12h.01",
  // industry glyphs
  store: "M3 9l2-5h14l2 5M3 9h18M3 9v11h18V9M9 20v-6h6v6",
  utensils: "M6 3v8a3 3 0 0 0 3 3v7M9 3v6M3 3v6a3 3 0 0 0 3 3M18 3c-2 0-3 2-3 5s1 4 3 4v9",
  hammer: "M15 12 6 21l-3-3 9-9M14 4l6 6-3 3-6-6 3-3Z",
  health: "M12 21s-8-4.5-8-11a5 5 0 0 1 8-4 5 5 0 0 1 8 4c0 6.5-8 11-8 11ZM12 9v5M9.5 11.5h5",
  briefcase: "M3 8h18v12H3zM9 8V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3M3 13h18",
  factory: "M3 21V10l6 4V10l6 4V6h6v15H3Z",
  truck: "M3 6h11v10H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm10 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  bank: "M3 10h18L12 4 3 10Zm2 0v8m4-8v8m6-8v8m4-8v8M3 20h18",
  home: "M3 11 12 4l9 7v9H3v-9Zm6 9v-6h6v6",
  wrench: "M14.7 6.3a4 4 0 0 0 5 5L22 14l-8 8-2.3-2.3a4 4 0 0 0-5-5L4 12l8-8 2.7 2.3Z",
  leaf: "M5 21c0-9 6-15 15-16-1 9-7 15-15 16Zm0 0 7-7",
  star: "m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z",
  building: "M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M8 7h4M8 11h4M8 15h4M3 21h18",
};

export default function Icon({ name, size = 18, className }: { name: string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? PATHS.building} />
    </svg>
  );
}

// Icon for a business by its NAICS code.
export function industryIcon(naics?: string | null) {
  const n = (naics ?? "").slice(0, 2);
  if (n === "72") return "utensils";
  if (n === "44" || n === "45") return "store";
  if (n === "23") return "hammer";
  if (n === "62") return "health";
  if (n === "31" || n === "32" || n === "33") return "factory";
  if (n === "48" || n === "49" || n === "42") return "truck";
  if (n === "52") return "bank";
  if (n === "53") return "home";
  if (n === "81") return "wrench";
  if (n === "11" || n === "21") return "leaf";
  if (n === "71") return "star";
  if (n === "54" || n === "55" || n === "56" || n === "51") return "briefcase";
  return "building";
}
