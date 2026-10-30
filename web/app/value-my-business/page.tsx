import Link from "next/link";
import Footer from "@/components/Footer";
import ValueCalculator, { type CalcIndustry } from "@/components/ValueCalculator";
import { sql } from "@/lib/db";
import { INDUSTRIES } from "@/lib/industries";
import { slug } from "@/lib/landing";
import { industryFactor, sizeMultiple } from "@/lib/valuation";

export const revalidate = 86400;
export const metadata = {
  title: "What's my business worth? Free Oklahoma business valuation calculator | SeeBITDA",
  description: "Estimate what your Oklahoma business is worth from its revenue and EBITDA, using the sale multiples buyers pay for companies your size in your industry.",
  alternates: { canonical: "/value-my-business" },
};

type Ref = { naics_prefix: string; margin_1m: string | null; margin_5m: string | null; margin_20m: string | null };
type Override = { naics_prefix: string; ebitda_margin: string | null; multiple: string | null };

// Longest NAICS prefix in the table that the code starts with.
const longest = <T extends { naics_prefix: string }>(rows: T[], code: string) =>
  rows.filter((r) => code.startsWith(r.naics_prefix)).sort((a, b) => b.naics_prefix.length - a.naics_prefix.length)[0];

// Each industry's typical margin and multiple, from the same figures the site's estimates use: our
// own (set in /admin/industries) first, then IRS margins and the published deal multiples.
async function industries(): Promise<CalcIndustry[]> {
  const [refs, overrides] = await Promise.all([
    sql<Ref[]>`select naics_prefix, margin_1m, margin_5m, margin_20m from industry_reference`.catch(() => [] as Ref[]),
    sql<Override[]>`select naics_prefix, ebitda_margin, multiple from industry_overrides`.catch(() => [] as Override[]),
  ]);
  const atRef = sizeMultiple(1_000_000);
  return INDUSTRIES.map((i) => {
    const code = i.naics[0];
    const o = longest(overrides, code);
    const r = longest(refs, code);
    const n = (v: string | null | undefined) => (v == null ? null : Number(v));
    return {
      label: i.label, slug: slug(i.label),
      // The admin's multiple is for a company with about $1M of EBITDA; it scales with size like the rest.
      factor: o?.multiple ? Number(o.multiple) / atRef : industryFactor(code),
      margins: o?.ebitda_margin ? [Number(o.ebitda_margin), Number(o.ebitda_margin), Number(o.ebitda_margin)]
        : r ? [n(r.margin_1m) ?? 0.1, n(r.margin_5m) ?? 0.1, n(r.margin_20m) ?? 0.1] : [0.1, 0.1, 0.1],
    };
  }).sort((a, b) => a.label.localeCompare(b.label));
}

const FAQ = [
  { q: "How is a small business valued?", a: "Most private companies sell for a multiple of their EBITDA (earnings before interest, taxes, depreciation and amortization). The multiple rises with size: a business with $250K of EBITDA often sells for about 3×, one with $5M for 6–7×. Industry moves it up or down a turn or so." },
  { q: "What if I don't know my EBITDA?", a: "Leave it blank and the calculator uses the typical margin for your industry and size, from IRS business tax statistics. Your own figure gives a much better answer: start from net profit and add back interest, taxes, depreciation, amortization, and any owner pay above a market salary." },
  { q: "Is this what I'd actually get?", a: "It's the typical price for a company like yours, not an appraisal. Steady growth, recurring customers, a team that runs without you, and clean books push a price up; one big customer, an owner who does everything, or falling sales push it down." },
];

export default async function ValueMyBusiness({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const p = await searchParams;
  const list = await industries();
  const ld = { "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) };
  return (
    <>
      <main className="page landing">
        <h1>What&apos;s my business worth?</h1>
        <p className="lede">A quick estimate from your revenue and profit, using what buyers typically pay for Oklahoma
          companies your size in your industry. Nothing you type is saved or sent anywhere.</p>
        <ValueCalculator industries={list} initial={{ industry: p.industry ?? "", revenue: p.revenue ?? "", ebitda: p.ebitda ?? "" }} />
        <div className="section">
          <h2>Common questions</h2>
          <dl className="faq">
            {FAQ.map((f) => <div key={f.q}><dt>{f.q}</dt><dd>{f.a}</dd></div>)}
          </dl>
          <p className="disclaimer">How the multiples are set: see the <Link href="/methodology">methodology</Link>. Already on
            SeeBITDA? Search for your business and use <b>Correct these figures</b> so its page shows the right numbers.</p>
        </div>
      </main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <Footer />
    </>
  );
}
