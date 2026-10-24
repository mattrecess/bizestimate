import Footer from "@/components/Footer";
import { notFound } from "next/navigation";
import { getBusinessRow, getProfile } from "@/lib/business";
import { money } from "@/lib/format";
import BusinessProfile from "@/components/BusinessProfile";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const b = await getBusinessRow((await params).id);
  if (!b) return { title: "Not found" };
  const where = [b.city, "OK"].filter(Boolean).join(", ");
  return {
    title: `${b.name} (${where}) — estimated revenue & EBITDA | BizEstimate`,
    description: `${b.name} in ${where}: estimated revenue ${money(b.est_revenue_mid)} and EBITDA ${money(b.est_ebitda_mid)} ` +
      `(${b.industry}), based on public SBA PPP loan data. Estimates only.`,
    alternates: { canonical: `/business/${b.id}` },
  };
}

export default async function BusinessPage({ params }: { params: Promise<{ id: string }> }) {
  const b = await getProfile((await params).id);
  if (!b) notFound();
  return (
    <>
      <main className="page">
        <BusinessProfile b={b} />
      </main>
      <Footer />
    </>
  );
}
