// The people who run a business, merged from every source we have into one list, owner first:
// the owner we found, the company's own website (team pages), web searches, Form 990 officers and the
// Form 5500 signer. The same person from two sources appears once, with both sources.

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Leader = { name: string; title: string; sources: string[]; url?: string; linkedin?: string; owner?: boolean };
export type Depth = "owner-run" | "team" | null;

// "HOGAN TAYLOR LLP" -> "Hogan Taylor LLP"; "JOHN A. SMITH" -> "John A. Smith".
const tidy = (s: string) => (s === s.toUpperCase()
  ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\b(Llp|Llc|Pllc|Pc|Cpa|Pa|Lp|Ii|Iii|Iv|Jr|Sr)\b/g, (w) => w.toUpperCase())
  : s).trim();

// "John A. Smith Jr." and "JOHN SMITH" are one person: first and last name, no middle initials or suffixes.
const personKey = (name: string) => {
  const w = name.toLowerCase().replace(/[^a-z\s'-]/g, " ").split(/\s+/)
    .filter((x) => x && !["jr", "sr", "ii", "iii", "iv", "dr", "mr", "mrs", "ms"].includes(x));
  const long = w.filter((x) => x.length > 1);
  return long.length >= 2 ? `${long[0]} ${long[long.length - 1]}` : w.join(" ");
};

// Most senior first: owners and chiefs, then the C-suite, presidents and VPs, then managers.
const RANKS: [RegExp, number][] = [
  [/\b(owner|founder|co-founder|proprietor|principal|managing (member|partner))\b/i, 0],
  [/\b(ceo|chief executive|president)\b/i, 1],
  [/\b(cfo|coo|cto|cio|cmo|chief|controller|treasurer)\b/i, 2],
  [/\b(vice president|vp|partner|director|general manager|gm)\b/i, 3],
  [/\b(manager|superintendent|supervisor|head of|lead)\b/i, 4],
];
const rank = (title: string) => RANKS.find(([re]) => re.test(title))?.[1] ?? 5;
// Someone other than the owner who could run the business: a buyer pays more when there is one.
const MANAGEMENT = /\b(ceo|president|chief|cfo|coo|controller|vice president|vp|director|general manager|gm|operations manager|office manager)\b/i;

export function leadership(b: { owner_name?: string | null; owner_title?: string | null; owner_source?: string | null },
  sources: { source: string; data: any }[], ownerLinkedIn?: string | null): { people: Leader[]; depth: Depth } {
  const by: Record<string, any> = Object.fromEntries(sources.map((s) => [s.source, s.data]));
  const people: Leader[] = [];
  const index = new Map<string, Leader>();
  const add = (p: Omit<Leader, "sources"> & { source: string }) => {
    if (!p.name || p.name.length < 3) return;
    const key = personKey(p.name);
    const have = index.get(key);
    if (have) {
      if (!have.sources.includes(p.source)) have.sources.push(p.source);
      if (!have.title && p.title) have.title = p.title;
      have.url ??= p.url;
      have.linkedin ??= p.linkedin;
      return;
    }
    const person: Leader = { name: tidy(p.name), title: p.title ? tidy(p.title) : "", sources: [p.source], url: p.url, linkedin: p.linkedin, owner: p.owner };
    index.set(key, person);
    people.push(person);
  };
  if (b.owner_name) add({ name: b.owner_name, title: b.owner_title || "Owner", source: "Owner research", url: b.owner_source ?? undefined, linkedin: ownerLinkedIn ?? undefined, owner: true });
  for (const p of by.website_profile?.team ?? []) add({ name: p.name, title: p.title, source: "Company website", url: p.url });
  for (const p of by.people_search?.people ?? []) add({ name: p.name, title: p.title, source: "Web search", url: p.url });
  // From the "Search the web for executives" button (app/api/leadership-search).
  for (const p of by.leadership_lookup?.people ?? []) add({ name: p.name, title: p.title || "Role not listed", source: "Web search", url: p.url });
  for (const p of by.irs990_people?.officers ?? []) add({ name: p.name, title: p.title || "Officer", source: "Form 990" });
  const signer = by.form5500_people?.signer;
  if (signer?.name) add({ name: signer.name, title: "", source: `Form 5500 (${signer.year})` });
  for (const p of people) p.title ||= "Signs company filings";
  // People you took off this business's page (app/api/admin/people).
  const hidden = new Set(((by.people_hidden?.names ?? []) as string[]).map(personKey));
  for (let i = people.length - 1; i >= 0; i--) if (!people[i].owner && hidden.has(personKey(people[i].name))) people.splice(i, 1);

  people.sort((a, c) => Number(!!c.owner) - Number(!!a.owner) || rank(a.title) - rank(c.title) || c.sources.length - a.sources.length);
  // Only judged when we know at least the owner: with no names at all, we can't say.
  const depth: Depth = !people.length ? null
    : people.some((p) => !p.owner && MANAGEMENT.test(p.title)) ? "team" : b.owner_name ? "owner-run" : null;
  return { people, depth };
}
