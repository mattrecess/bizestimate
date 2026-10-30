import Link from "next/link";
import Footer from "@/components/Footer";
import { industryCounts, slug } from "@/lib/landing";

export const revalidate = 86400;
export const dynamic = "force-dynamic";   // not built ahead: it reads the database
export const metadata = {
  title: "Oklahoma businesses by industry: revenue & EBITDA estimates | SeeBITDA",
  description: "Browse Oklahoma private companies by industry and city, with estimated revenue, EBITDA and value.",
  alternates: { canonical: "/oklahoma" },
};

export default async function Industries() {
  const rows = (await industryCounts()).sort((a, b) => a.ind.label.localeCompare(b.ind.label));
  return (
    <>
      <main className="page landing">
        <h1>Oklahoma businesses by industry</h1>
        <p className="lede">Estimated revenue, EBITDA and value for private companies across Oklahoma.</p>
        <div className="section">
          <ul className="link-grid">
            {rows.map(({ ind, count }) => (
              <li key={ind.label}><Link href={`/oklahoma/${slug(ind.label)}`}>{ind.label}</Link> <span>{count.toLocaleString()}</span></li>
            ))}
          </ul>
        </div>
      </main>
      <Footer />
    </>
  );
}
