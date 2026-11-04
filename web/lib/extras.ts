// Extra columns for the table view and the Excel export (signed-in only): ownership type, the current owner
// (a PE firm or parent company when there is one, else the person), the business's bank, and, for Pro users,
// email and phone: the owner's own when a lookup found them (phones only after the contact-use terms were
// accepted), else the business's published ones. Businesses that opted out of contact details get none.
import { sql } from "./db";
import { ownershipType, type Ownership } from "./ownership";
import type { Transaction } from "./business";
import type { OwnerContact } from "./pdl";

export type Extras = { ownership: Ownership; current_owner: string | null; bank: string | null;
  email?: string | null; phone?: string | null; email_owner?: boolean; phone_owner?: boolean };

export async function extrasFor(ids: number[], contacts: { phones: boolean } | null): Promise<Record<number, Extras>> {
  if (!ids.length) return {};
  const rows = await sql`
    select b.id, b.biz_key, b.owner_name, b.owner_title,
      exists (select 1 from business_sources s where s.biz_key = b.biz_key and s.source = 'sec') as public,
      (select s.data ->> 'family_owned' from business_sources s where s.biz_key = b.biz_key and s.source = 'website_profile') as family,
      (select jsonb_agg(jsonb_build_object('buyer', t.buyer, 'deal_type', t.deal_type, 'deal_date', to_char(t.deal_date, 'YYYY-MM-DD'),
                'investor', t.source = 'portfolio' or exists (select 1 from investors i where lower(i.name) = lower(t.buyer)))
              order by t.deal_date desc nulls last)
         from transactions t where t.biz_key = b.biz_key and t.is_public) as deals,
      (select l.lender from business_lenders l where l.business_id = b.id order by l.year desc nulls last, l.amount desc nulls last limit 1) as bank
    from businesses b where b.id in ${sql(ids)}`;
  const out: Record<number, Extras> = {};
  for (const r of rows) {
    const deals = (r.deals ?? []) as Transaction[];
    const ownership = ownershipType({ owner_name: r.owner_name, owner_title: r.owner_title },
      { sec: r.public ? {} : undefined, website_profile: r.family === "true" ? { family_owned: true } : undefined }, deals);
    out[Number(r.id)] = { ownership, current_owner: ownership.owner ?? r.owner_name ?? null, bank: r.bank ?? null };
  }
  if (contacts) {
    const c = await sql`
      select b.id, b.phone, to_jsonb(b) ->> 'site_phone' as site_phone, to_jsonb(b) ->> 'site_email' as site_email,
             (select o.data from owner_contacts o where o.biz_key = b.biz_key and o.found) as owner
      from businesses b where b.id in ${sql(ids)}
        and not exists (select 1 from contact_optouts x where x.biz_key = b.biz_key)`.catch(() => [] as never[]);
    for (const r of c) {
      const e = out[Number(r.id)];
      if (!e) continue;
      const owner = r.owner as OwnerContact | null;
      const ownerEmail = owner?.emails?.[0]?.value ?? null;
      const ownerPhone = contacts.phones ? owner?.phones?.[0]?.value ?? null : null;
      e.email = ownerEmail ?? r.site_email ?? null;
      e.email_owner = !!ownerEmail;
      e.phone = ownerPhone ?? r.site_phone ?? r.phone ?? null;
      e.phone_owner = !!ownerPhone;
    }
  }
  return out;
}
