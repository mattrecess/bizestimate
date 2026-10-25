import { sql } from "./db";

export type ContactItem = { value: string; source: string; url?: string | null; owner?: boolean };
export type Contact = { phones: ContactItem[]; emails: ContactItem[]; hidden?: boolean };

// The business's own published contact details, best first: its website, then its map listing,
// then its federal motor-carrier registration. Hidden when the business asked for that.
export async function getContact(id: string): Promise<Contact | null> {
  if (!/^\d+$/.test(id)) return null;
  const [b] = await sql`
    select b.biz_key, to_jsonb(b) ->> 'owner_name' as owner_name, to_jsonb(b) ->> 'phone' as phone,
           to_jsonb(b) ->> 'site_phone' as site_phone, to_jsonb(b) ->> 'site_email' as site_email,
           to_jsonb(b) ->> 'contact_page' as contact_page, to_jsonb(b) ->> 'website' as website,
           (select s.data from business_sources s where s.biz_key = b.biz_key and s.source = 'fmcsa') as fmcsa
    from businesses b where b.id = ${id}`;
  if (!b) return null;
  const [optout] = await sql`select 1 from contact_optouts where biz_key = ${b.biz_key}`.catch(() => []);
  if (optout) return { phones: [], emails: [], hidden: true };

  const phones: ContactItem[] = [];
  const emails: ContactItem[] = [];
  const addPhone = (value: string | null | undefined, source: string, url?: string | null) => {
    if (value && !phones.some((p) => p.value === value)) phones.push({ value, source, url });
  };
  addPhone(b.site_phone, "Company website", b.contact_page || b.website);
  addPhone(b.phone, "Map listing");
  addPhone(b.fmcsa?.phone, "FMCSA registration", b.fmcsa?.url);

  // An address with the owner's first or last name in it is likely theirs ("randy@huntermech.com").
  const ownerParts = String(b.owner_name ?? "").toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const isOwner = (e: string) => ownerParts.some((w) => e.split("@")[0].includes(w));
  for (const e of String(b.site_email ?? "").split(/;\s*/).filter(Boolean)) {
    emails.push({ value: e, source: "Company website", url: b.contact_page || b.website, owner: isOwner(e) });
  }
  if (b.fmcsa?.email && !emails.some((x) => x.value === b.fmcsa.email)) {
    emails.push({ value: b.fmcsa.email, source: "FMCSA registration", url: b.fmcsa.url, owner: isOwner(b.fmcsa.email) });
  }
  emails.sort((x, y) => Number(!!y.owner) - Number(!!x.owner));
  return { phones, emails };
}
