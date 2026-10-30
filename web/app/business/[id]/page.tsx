import Footer from "@/components/Footer";
import { notFound } from "next/navigation";
import { getBusinessRow, getProfile } from "@/lib/business";
import { money } from "@/lib/format";
import BusinessProfile from "@/components/BusinessProfile";
import { SITE_URL } from "@/lib/site";
import { businessFacts, displayName } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const b = await getBusinessRow((await params).id);
  if (!b) return { title: "Not found" };
  const where = [b.city, "OK"].filter(Boolean).join(", ");
  const name = displayName(b.name);
  // Titles lead with what people search for: who owns it, what it makes, what it's worth.
  return {
    title: b.owner_name ? `${name} (${where}): owner ${b.owner_name}, revenue & value | SeeBITDA`
      : `${name} (${where}): owner, revenue & value | SeeBITDA`,
    description: `${b.owner_name ? `${name} is owned by ${b.owner_name}. ` : ""}${b.industry ?? "Business"} in ${where} with estimated ` +
      `revenue of ${money(b.est_revenue_mid)} and EBITDA of ${money(b.est_ebitda_mid)}, from public records. Owner, value, employees and history.`,
    alternates: { canonical: `/business/${b.id}` },
  };
}

export default async function BusinessPage({ params }: { params: Promise<{ id: string }> }) {
  const b = await getProfile((await params).id);
  if (!b) notFound();
  const facts = businessFacts(b);
  // Structured data: the business (with its owner) and the questions this page answers.
  const ld = [{
    "@context": "https://schema.org", "@type": "LocalBusiness", name: facts.name, url: `${SITE_URL}/business/${b.id}`,
    ...(b.website ? { sameAs: [b.website] } : {}),
    address: { "@type": "PostalAddress", ...(b.address ? { streetAddress: b.address } : {}), addressLocality: b.city,
      addressRegion: "OK", postalCode: b.zip, addressCountry: "US" },
    ...(b.lat != null && b.geo_precision !== "zip" ? { geo: { "@type": "GeoCoordinates", latitude: Number(b.lat), longitude: Number(b.lon) } } : {}),
    ...(b.owner_name ? { employee: { "@type": "Person", name: b.owner_name, jobTitle: b.owner_title || "Owner" } } : {}),
    description: facts.summary,
  }, {
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: facts.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  }];
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
      <main className="page">
        <BusinessProfile b={b} />
        <section className="bp-about" aria-labelledby="about-h">
          <h2 id="about-h">About {facts.name}</h2>
          <p>{facts.summary}</p>
          <h2>Common questions</h2>
          <dl>
            {facts.faq.map((f) => (<div key={f.q}><dt>{f.q}</dt><dd>{f.a}</dd></div>))}
          </dl>
        </section>
      </main>
      <Footer />
    </>
  );
}
