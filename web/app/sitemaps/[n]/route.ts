import { sql } from "@/lib/db";
import { SITE_URL } from "@/lib/site";
import { PER_SITEMAP, urlset, xml } from "@/lib/sitemap";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ n: string }> }) {
  const n = Number((await params).n);
  if (!Number.isInteger(n) || n < 0) return new Response("Not found", { status: 404 });
  const rows = await sql`
    select id from businesses where id > ${n * PER_SITEMAP} and id <= ${(n + 1) * PER_SITEMAP} order by id`;
  const fixed = n === 0 ? [SITE_URL, `${SITE_URL}/methodology`, `${SITE_URL}/terms`] : [];
  return xml(urlset(fixed.concat(rows.map((r) => `${SITE_URL}/business/${r.id}`))));
}
