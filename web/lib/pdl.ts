// Owner contact lookups through People Data Labs' person enrichment API: the owner's name and company
// in, their work email, phones and LinkedIn out. PDL charges only for a match. PDL_API_KEY is set in
// Vercel; without it the lookup reports that it isn't set up.

export type OwnerContact = {
  found: boolean;
  name?: string | null;
  title?: string | null;
  emails: { value: string; kind: string }[];
  phones: { value: string; kind: string }[];
  linkedin?: string | null;
  likelihood?: number | null;
};

const ENDPOINT = "https://api.peopledatalabs.com/v5/person/enrich";
const MIN_LIKELIHOOD = 6;   // PDL's 1-10 match confidence; below this the person may not be the owner

export const pdlConfigured = () => !!process.env.PDL_API_KEY;

/* eslint-disable @typescript-eslint/no-explicit-any */
const asList = (v: any): any[] => (Array.isArray(v) ? v : v ? [v] : []);
const text = (v: any) => (typeof v === "string" ? v : typeof v?.address === "string" ? v.address : typeof v?.number === "string" ? v.number : null);

export async function lookupOwner(owner: string, company: string, city: string | null): Promise<OwnerContact> {
  const params = new URLSearchParams({
    name: owner, company, region: "oklahoma", country: "united states",
    min_likelihood: String(MIN_LIKELIHOOD), titlecase: "true",
  });
  if (city) params.set("locality", city.toLowerCase());
  const res = await fetch(`${ENDPOINT}?${params}`, { headers: { "X-Api-Key": process.env.PDL_API_KEY! }, cache: "no-store" });
  if (res.status === 404) return { found: false, emails: [], phones: [] };   // no match (not charged)
  if (!res.ok) throw new Error(`People Data Labs: ${res.status}`);
  const body = await res.json();
  const d = body.data ?? {};
  // Field names as PDL documents them; read defensively, since what's returned depends on the plan.
  const emails = new Map<string, string>();
  const work = text(d.work_email);
  if (work) emails.set(work.toLowerCase(), "work");
  // Work addresses only: personal ones (Gmail and the like) aren't for business outreach.
  for (const e of asList(d.emails)) {
    if (e?.type === "personal") continue;
    const v = text(e);
    if (v && !emails.has(v.toLowerCase())) emails.set(v.toLowerCase(), e?.type === "professional" || e?.type === "current_professional" ? "work" : "other");
  }
  const phones = new Map<string, string>();
  const mobile = text(d.mobile_phone);
  if (mobile) phones.set(mobile, "mobile");
  for (const p of asList(d.phone_numbers)) {
    const v = text(p);
    if (v && !phones.has(v)) phones.set(v, "phone");
  }
  const linkedin = text(d.linkedin_url);
  return {
    found: emails.size > 0 || phones.size > 0 || !!linkedin,
    name: d.full_name ?? null, title: d.job_title ?? null,
    emails: [...emails].map(([value, kind]) => ({ value, kind })),
    phones: [...phones].map(([value, kind]) => ({ value, kind })),
    linkedin: linkedin ? (linkedin.startsWith("http") ? linkedin : `https://${linkedin}`) : null,
    likelihood: body.likelihood ?? null,
  };
}
