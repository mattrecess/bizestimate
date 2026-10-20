import type { Metadata } from "next";
import Link from "next/link";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "BizEstimate — Oklahoma business values",
  description: "Estimated revenue and EBITDA for Oklahoma businesses, from public PPP loan data.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <Link href="/" className="brand">BizEstimate</Link>
          <span style={{ color: "var(--muted)" }}>Oklahoma</span>
          <nav><Link href="/methodology">How estimates work</Link></nav>
        </header>
        {children}
        <footer className="foot">
          <span>Estimates from public SBA PPP loan data. Not reported financials.</span>
          <nav><Link href="/methodology">Methodology</Link><Link href="/terms">Terms &amp; disclaimer</Link></nav>
        </footer>
      </body>
    </html>
  );
}
