import { sql } from "@/lib/db";
import { SITE_URL } from "@/lib/site";
import { PER_SITEMAP, xml } from "@/lib/sitemap";

export const dynamic = "force-dynamic";

// Sitemap index: one child sitemap per block of business ids.
export async function GET() {
  const [{ max }] = await sql`select coalesce(max(id), 0)::int as max from businesses`;
  const count = Math.max(1, Math.ceil(max / PER_SITEMAP));
  const items = Array.from({ length: count }, (_, n) => `<sitemap><loc>${SITE_URL}/sitemaps/${n}</loc></sitemap>`);
  items.push(`<sitemap><loc>${SITE_URL}/sitemaps/pages</loc></sitemap>`);
  return xml(`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${items.join("")}</sitemapindex>`);
}
