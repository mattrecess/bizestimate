import Footer from "@/components/Footer";
import { notFound } from "next/navigation";
import { getBusinessRow, getProfile } from "@/lib/business";
import { money } from "@/lib/format";
import BusinessProfile from "@/components/BusinessProfile";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const b = await getBusinessRow((await params).id);
  if (!b) return { title: "Not found" };
  const where = [b.city, "OK"].filter(Boolean).join(", ");
  return {
    title: `${b.name} (${where}) — estimated revenue & EBITDA | SeeBITDA`,
    description: `${b.name} in ${where}: estimated revenue ${money(b.est_revenue_mid)}, EBITDA ${money(b.est_ebitda_mid)} ` +
      `and business value (${b.industry}), from public records.${b.owner_name ? ` Owner: ${b.owner_name}.` : ""} Estimates only.`,
    alternates: { canonical: `/business/${b.id}` },
  };
}

export default async function BusinessPage({ params }: { params: Promise<{ id: string }> }) {
  const b = await getProfile((await params).id);
  if (!b) notFound();
  // Structured data so search engines know the page is about this local business (facts only, no estimates).
  const ld = {
    "@context": "https://schema.org", "@type": "LocalBusiness", name: b.name, url: `${SITE_URL}/business/${b.id}`,
    ...(b.website ? { sameAs: [b.website] } : {}),
    address: { "@type": "PostalAddress", ...(b.address ? { streetAddress: b.address } : {}), addressLocality: b.city,
      addressRegion: "OK", postalCode: b.zip, addressCountry: "US" },
    ...(b.lat != null && b.geo_precision !== "zip" ? { geo: { "@type": "GeoCoordinates", latitude: Number(b.lat), longitude: Number(b.lon) } } : {}),
    ...(b.industry ? { description: `${b.industry} business in ${b.city}, Oklahoma.` } : {}),
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
      <main className="page">
        <BusinessProfile b={b} />
      </main>
      <Footer />
    </>
  );
}
