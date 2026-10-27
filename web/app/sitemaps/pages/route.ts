import { SITE_URL } from "@/lib/site";
import { urlset, xml } from "@/lib/sitemap";
import { cities, industryCounts, slug } from "@/lib/landing";

export const dynamic = "force-dynamic";   // reads the database; the CDN caches it a day (sitemap.ts)

// Industry and industry-in-a-city pages.
export async function GET() {
  const urls = [`${SITE_URL}/oklahoma`];
  for (const { ind } of await industryCounts()) {
    urls.push(`${SITE_URL}/oklahoma/${slug(ind.label)}`);
    for (const c of await cities(ind)) urls.push(`${SITE_URL}/oklahoma/${slug(ind.label)}/${slug(c.city)}`);
  }
  return xml(urlset(urls));
}
