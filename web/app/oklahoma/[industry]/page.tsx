import { notFound } from "next/navigation";
import Footer from "@/components/Footer";
import Landing from "@/components/Landing";
import { cities, deals, industryBySlug, MIN_LISTED, sellers, slug, summary, top } from "@/lib/landing";
import { money } from "@/lib/format";

export const revalidate = 86400;

export async function generateMetadata({ params }: { params: Promise<{ industry: string }> }) {
  const ind = industryBySlug((await params).industry);
  if (!ind) return { title: "Not found" };
  const s = await summary(ind);
  return {
    title: `${ind.label} in Oklahoma: ${s.count.toLocaleString()} businesses, revenue & EBITDA | BizEstimate`,
    description: `${s.count.toLocaleString()} Oklahoma ${ind.label.toLowerCase()} businesses with estimated revenue, EBITDA and value. ` +
      `Typical revenue ${money(s.revenue_median)}.`,
    alternates: { canonical: `/oklahoma/${slug(ind.label)}` },
  };
}

export default async function IndustryPage({ params }: { params: Promise<{ industry: string }> }) {
  const ind = industryBySlug((await params).industry);
  if (!ind) notFound();
  const [s, rows, list, sell, recent] = await Promise.all([summary(ind), top(ind), cities(ind), sellers(ind), deals(ind)]);
  if (s.count < MIN_LISTED) notFound();
  return (<><Landing ind={ind} s={s} rows={rows} cities={list} sellers={sell} deals={recent} /><Footer /></>);
}
