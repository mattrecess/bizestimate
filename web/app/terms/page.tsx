import Link from "next/link";

export const metadata = { title: "Terms & disclaimer | BizEstimate" };

export default function Terms() {
  return (
    <main className="page">
      <h1>Terms &amp; disclaimer</h1>
      <div className="section">
        <h2>Estimates, not facts</h2>
        <p>Every revenue, EBITDA and payroll figure on BizEstimate is a statistical estimate produced by a model.
          None of them are reported financials, and none were provided by the businesses listed. They can be
          substantially wrong. Do not rely on them for lending, investment, credit, employment, insurance or any
          other decision without independent verification.</p>
      </div>
      <div className="section">
        <h2>Where the data comes from</h2>
        <p>Business names, addresses, industry codes, reported jobs and loan details come from the U.S. Small
          Business Administration&apos;s public Paycheck Protection Program (PPP) loan data, released under the
          Freedom of Information Act. Industry ratios come from U.S. Census Bureau data. Locations come from the
          Census geocoder. Loan data reflects 2020–2021 and may be out of date; a listed business may have
          moved, changed or closed. See <Link href="/methodology">how estimates work</Link>.</p>
      </div>
      <div className="section">
        <h2>Privacy</h2>
        <p>Sole proprietors, self-employed individuals and independent contractors are not listed, since their
          business address is often a home address.</p>
      </div>
      <div className="section">
        <h2>Corrections and removal</h2>
        <p>If you own or represent a listed business, use the <strong>Own this business?</strong> form on its page
          to correct the figures or ask for the listing to be removed. We review every request.</p>
      </div>
      <div className="section">
        <h2>No warranty</h2>
        <p>The site is provided &quot;as is&quot;, without warranties of any kind. To the fullest extent permitted by
          law, BizEstimate is not liable for any loss arising from use of the site or its estimates.</p>
      </div>
      <p className="disclaimer">Not affiliated with the SBA, the U.S. Census Bureau, or any listed business.</p>
    </main>
  );
}
