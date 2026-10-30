import Link from "next/link";

export default function Footer() {
  return (
    <footer className="foot">
      <span>Estimates from public government data (SBA, DOL, IRS) and Overture Maps. Not audited financials.</span>
      <nav><Link href="/value-my-business">What&apos;s my business worth?</Link><Link href="/oklahoma">Browse by industry</Link><Link href="/likely-to-sell">Likely to sell</Link><Link href="/deals">Recent deals</Link><Link href="/methodology">Methodology</Link><Link href="/terms">Terms &amp; disclaimer</Link></nav>
    </footer>
  );
}
