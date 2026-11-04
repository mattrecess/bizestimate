import { Analytics } from "@vercel/analytics/next";
import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "@fontsource-variable/inter";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import AccountMenu from "@/components/AccountMenu";
import SignInPrompt from "@/components/SignInPrompt";
import UpgradePrompt from "@/components/UpgradePrompt";
import Icon from "@/components/Icon";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "SeeBITDA: see what any business is worth",
  description: "See estimated revenue, EBITDA and value for Oklahoma private businesses, from public records.",
  // Google Search Console ownership check: set GOOGLE_SITE_VERIFICATION in Vercel to the code Google gives.
  verification: process.env.GOOGLE_SITE_VERIFICATION ? { google: process.env.GOOGLE_SITE_VERIFICATION } : undefined,
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#111a2b" },
  ],
};

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#0b3b75" />
      <rect x="7" y="17" width="4" height="8" rx="1.2" fill="#8bb4ff" />
      <rect x="14" y="12" width="4" height="13" rx="1.2" fill="#b9d1ff" />
      <rect x="21" y="7" width="4" height="18" rx="1.2" fill="#ffffff" />
    </svg>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Tells Google "SeeBITDA" is this site's name (a brand, not a misspelling of EBITDA), for brand searches. */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify([
          { "@context": "https://schema.org", "@type": "WebSite", name: "SeeBITDA", alternateName: ["See EBITDA", "seebitda.com"], url: `${SITE_URL}/` },
          { "@context": "https://schema.org", "@type": "Organization", name: "SeeBITDA", url: `${SITE_URL}/`, logo: `${SITE_URL}/icon.svg`,
            description: "Estimated revenue, EBITDA and value for Oklahoma private businesses, from public records." },
        ]) }} />
        <header className="top">
          <Link href="/" className="brand" aria-label="SeeBITDA home"><BrandMark /><span>See<span className="brand-em">BITDA</span></span></Link>
          <span className="state-chip">Oklahoma</span>
          <nav>
            <Link href="/radar" className="nav-radar"><Icon name="radar" size={16} />My Radar</Link>
            <AccountMenu />
          </nav>
        </header>
        {children}
        <SignInPrompt />
        <UpgradePrompt />
        {/* Page-view counts (no cookies); shows in Vercel once Web Analytics is enabled for the project. */}
        <Analytics />
      </body>
    </html>
  );
}
