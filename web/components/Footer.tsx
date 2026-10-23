import Link from "next/link";

export default function Footer() {
  return (
    <footer className="foot">
      <span>Estimates from public SBA PPP loan data and Overture Maps. Not reported financials.</span>
      <nav><Link href="/methodology">Methodology</Link><Link href="/terms">Terms &amp; disclaimer</Link></nav>
    </footer>
  );
}
