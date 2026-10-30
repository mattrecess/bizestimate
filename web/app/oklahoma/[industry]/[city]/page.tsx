import { notFound, redirect } from "next/navigation";
import Footer from "@/components/Footer";
import Landing from "@/components/Landing";
import { cityBySlug, deals, industryBySlug, sellers, slug, summary, top } from "@/lib/landing";
import { money } from "@/lib/format";

export const revalidate = 86400;

type P = { params: Promise<{ industry: string; city: string }> };

async function resolve(params: P["params"]) {
  const p = await params;
  const ind = industryBySlug(p.industry);
  const city = ind ? await cityBySlug(ind, p.city) : null;
  return ind && city ? { ind, city: city.city } : null;
}

export async function generateMetadata({ params }: P) {
  const r = await resolve(params);
  if (!r) return { title: "Not found" };
  const s = await summary(r.ind, r.city);
  return {
    title: `${r.ind.label} in ${r.city}, OK: ${s.count.toLocaleString()} businesses, revenue & EBITDA | SeeBITDA`,
    description: `${s.count.toLocaleString()} ${r.ind.label.toLowerCase()} businesses in ${r.city}, Oklahoma, with estimated ` +
      `revenue, EBITDA and value. Typical revenue ${money(s.revenue_median)}.`,
    alternates: { canonical: `/oklahoma/${slug(r.ind.label)}/${slug(r.city)}` },
  };
}

export default async function CityPage({ params }: P) {
  const r = await resolve(params);
  if (!r) {
    // Too few businesses there for a page of their own (profiles link here): the statewide page.
    const ind = industryBySlug((await params).industry);
    if (ind) redirect(`/oklahoma/${slug(ind.label)}`);
    notFound();
  }
  const [s, rows, sell, recent] = await Promise.all([summary(r.ind, r.city), top(r.ind, r.city), sellers(r.ind, r.city), deals(r.ind, r.city)]);
  return (<><Landing ind={r.ind} city={r.city} s={s} rows={rows} sellers={sell} deals={recent} /><Footer /></>);
}
