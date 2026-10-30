import { SITE_URL } from "@/lib/site";
import { urlset, xml } from "@/lib/sitemap";
import { allIndustryCities, slug } from "@/lib/landing";

export const dynamic = "force-dynamic";   // reads the database; the CDN caches it a day (sitemap.ts)

// Industry and industry-in-a-city pages.
export async function GET() {
  const urls = [`${SITE_URL}/oklahoma`, `${SITE_URL}/deals`, `${SITE_URL}/likely-to-sell`, `${SITE_URL}/methodology`];
  for (const { ind, cities } of await allIndustryCities()) {
    urls.push(`${SITE_URL}/oklahoma/${slug(ind.label)}`);
    for (const city of cities) urls.push(`${SITE_URL}/oklahoma/${slug(ind.label)}/${slug(city)}`);
  }
  return xml(urlset(urls));
}
