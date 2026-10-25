// RocketReach person lookups for /admin (owner email and phone). The data is licensed to the account
// holder for their own use, so results are only ever shown in the admin area.
const BASE = process.env.ROCKETREACH_API_URL || "https://api.rocketreach.co/api/v2";   // override for testing
const DONE = new Set(["complete", "failed", "not_found"]);

export const rocketReachConfigured = () => !!process.env.ROCKETREACH_API_KEY;

type Person = Record<string, unknown> & { id?: number | string; status?: string };

async function call(path: string, params: Record<string, string>) {
  const res = await fetch(`${BASE}${path}?${new URLSearchParams(params)}`, {
    headers: { "Api-Key": process.env.ROCKETREACH_API_KEY ?? "" }, cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`RocketReach ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

// checkStatus returns a list of profiles (sometimes wrapped as {profiles: [...]}).
async function checkStatus(id: string): Promise<Person | null> {
  const data = await call("/person/checkStatus", { ids: id });
  const list = Array.isArray(data) ? data : (data?.profiles ?? []);
  return list.find((p: Person) => String(p.id) === id) ?? list[0] ?? null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Looks up one person (spends a credit unless RocketReach already has them for this account) and
// waits up to waitMs for the search to finish; an unfinished one can be refreshed later for free.
export async function lookupPerson(name: string, employer: string, waitMs = 20_000): Promise<Person> {
  let person: Person = await call("/person/lookup", { name, current_employer: employer });
  const deadline = Date.now() + waitMs;
  while (person.id != null && !DONE.has(String(person.status ?? "")) && Date.now() < deadline) {
    await sleep(2500);
    person = (await checkStatus(String(person.id))) ?? person;
  }
  return person;
}

export async function refreshPerson(id: string): Promise<Person | null> {
  return checkStatus(id);
}

export type Found = { value: string; type?: string; note?: string };

// The emails and phone numbers in a RocketReach profile, whatever shape each list item takes.
export function contactsOf(person: Record<string, any> | null) {  // eslint-disable-line @typescript-eslint/no-explicit-any
  const emails: Found[] = [];
  const phones: Found[] = [];
  if (!person) return { emails, phones };
  for (const e of person.emails ?? []) {
    const value = typeof e === "string" ? e : e?.email;
    if (value && !emails.some((x) => x.value === value)) {
      emails.push({ value, type: e?.type, note: [e?.grade && `grade ${e.grade}`, e?.smtp_valid].filter(Boolean).join(", ") || undefined });
    }
  }
  for (const [key, type] of [["recommended_email", "recommended"], ["current_work_email", "work"], ["current_personal_email", "personal"]]) {
    const value = person[key];
    if (typeof value === "string" && value && !emails.some((x) => x.value === value)) emails.push({ value, type });
  }
  for (const p of person.phones ?? []) {
    const value = typeof p === "string" ? p : p?.number;
    if (value && !phones.some((x) => x.value === value)) {
      phones.push({ value, type: p?.type, note: p?.recommended ? "recommended" : undefined });
    }
  }
  return { emails, phones };
}
