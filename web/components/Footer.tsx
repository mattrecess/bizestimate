import Link from "next/link";

export default function Footer() {
  return (
    <footer className="foot">
      <span>Estimates from public government data (SBA, DOL, IRS) and Overture Maps. Not audited financials.</span>
      <nav><Link href="/oklahoma">Browse by industry</Link><Link href="/deals">Recent deals</Link><Link href="/methodology">Methodology</Link><Link href="/terms">Terms &amp; disclaimer</Link></nav>
    </footer>
  );
}
