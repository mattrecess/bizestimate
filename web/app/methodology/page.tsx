import Footer from "@/components/Footer";
export const metadata = { title: "How estimates work | SeeBITDA" };

export default function Methodology() {
  return (
    <>
      <main className="page">
        <h1>How estimates work</h1>
        <div className="section">
          <h2>The calculation</h2>
          <p>Every employee-based estimate is the same four steps:</p>
          <p><code>employees × growth since they were counted × industry revenue per employee = revenue</code><br />
            <code>revenue × industry EBITDA margin = EBITDA</code><br />
            <code>EBITDA × sale multiple = value</code></p>
          <p>Each business page shows these steps with its own numbers under &ldquo;How we got&rdquo;.</p>
        </div>
        <div className="section">
          <h2>1. Employees: the newest count we have</h2>
          <p>When a business has filed a Form 5500 for its 401(k) plan in the last two plan years, we use the number
            of employees in that plan (<strong>401(k) data</strong>). Otherwise we use the employees it reported for
            its 2020 Paycheck Protection Program loan. Trucking companies whose federal registration shows more drivers
            or trucks than that use the fleet (<strong>Fleet data</strong>). We skip a 401(k) count with fewer than 3
            participants (often an owners-only plan) or more than four times the PPP headcount (more often a mismatch or a
            parent company&apos;s plan).</p>
        </div>
        <div className="section">
          <h2>2. Growth since the count</h2>
          <p>The count is grown 8% a year from when it was taken (mid-2020 for PPP, the end of the plan year for a 401(k)
            filing) to today.</p>
        </div>
        <div className="section">
          <h2>3. Revenue per employee</h2>
          <p>Employees today are multiplied by the typical revenue per employee in the business&apos;s industry (by NAICS
            code), from the U.S. Economic Census, kept between $100,000 and $500,000. A few equipment- or
            inventory-heavy industries use our own figure instead (for example sand and gravel, and wholesale).</p>
        </div>
        <div className="section">
          <h2>4. EBITDA from industry margins</h2>
          <p>Revenue is multiplied by an EBITDA margin from IRS Statistics of Income data: the actual tax returns of
            S corporations in the same industry, tax years 2019–2022 pooled, scaled to the company&apos;s size. Some
            industries use a margin that rises with size (for example HVAC and plumbing contractors).</p>
        </div>
        <div className="section">
          <h2>Businesses without a PPP loan</h2>
          <p>Many businesses never took a PPP loan. We list those from Overture Maps&apos; open business directory
            (skipping any already in the loan data), marked <strong>Industry avg</strong>. With no business-specific
            data, their figures are the typical estimated revenue of PPP businesses in the same industry in Oklahoma:
            the middle value, with a range covering the middle half. They say nothing about that particular business.</p>
        </div>
        <div className="section">
          <h2>Companies known from public records</h2>
          <p>Trucking companies registered with the Federal Motor Carrier Safety Administration, and employers that file
            a Form 5500 for their 401(k) plan, are listed even without a loan or map listing. Carriers are sized from the
            drivers and trucks on their registration (<strong>Fleet data</strong>), plan sponsors from the employees in
            their plan. Only registered companies (LLC, Inc., Corp. and similar) are listed this way.</p>
        </div>
        <div className="section">
          <h2>Estimated value</h2>
          <p>Value is EBITDA times a typical sale multiple for a company of that size, adjusted for its industry.
            Multiples rise with size: small owner-run firms sell for 2–3× EBITDA, companies earning $10M or more for 7×
            or more. Industry adjustments come from published private-company deal data (First Page Sage&apos;s analysis
            of M&amp;A deals by industry and size, 2022–2025), cross-checked against Damodaran&apos;s sector multiples for
            public companies. Nonprofits, banks and public companies get no value estimate.</p>
        </div>
        <div className="section">
          <h2>Which businesses are listed</h2>
          <p>Most businesses are pinned at their own street address. When an address can&apos;t be matched to a map location,
            the business is placed in its ZIP code and its page says the location is approximate. Sole proprietors,
            self-employed individuals and independent contractors are not listed, since their address is often a home.</p>
        </div>
        <p className="disclaimer">Source data: SBA PPP FOIA release, DOL Form 5500 filings, FMCSA motor carrier census, Overture Maps and IRS Statistics of Income (public records). All figures are statistical
          estimates, not reported financials.</p>
      </main>
      <Footer />
    </>
  );
}
