import { Analytics } from "@vercel/analytics/next";
import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "@fontsource-variable/inter";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "BizEstimate — Oklahoma business values",
  description: "Estimated revenue and EBITDA for Oklahoma businesses, from public PPP loan data.",
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
        <header className="top">
          <Link href="/" className="brand"><BrandMark />BizEstimate</Link>
          <span className="state-chip">Oklahoma</span>
          <nav>
            <Link href="/saved">Saved</Link>
            <Link href="/terms" className="hide-sm">Terms</Link>
          </nav>
        </header>
        {children}
        {/* Page-view counts (no cookies); shows in Vercel once Web Analytics is enabled for the project. */}
        <Analytics />
      </body>
    </html>
  );
}
