import Footer from "@/components/Footer";
export const metadata = { title: "How estimates work | BizEstimate" };

export default function Methodology() {
  return (
    <>
      <main className="page">
        <h1>How estimates work</h1>
        <div className="section">
          <h2>1. Revenue from employees</h2>
          <p>Each business reported its number of employees when it applied for a Paycheck Protection Program loan.
            We multiply that headcount by the typical revenue per employee in the business&apos;s industry (by NAICS
            code): <code>revenue = employees × industry revenue per employee</code>. The range shown runs from 70% to
            140% of that figure.</p>
        </div>
        <div className="section">
          <h2>2. EBITDA from industry margins</h2>
          <p>Revenue is multiplied by an EBITDA margin from IRS Statistics of Income data: the actual tax returns of
            S corporations (the usual structure for small and mid-sized companies) in the same industry, tax years
            2019–2022 pooled. EBITDA is net business income plus interest, depreciation, depletion and amortization,
            after owners&apos; salaries. Margins vary with size (across all industries, companies with $1–2.5M in
            revenue earn about 12%, those with $10–50M about 9%), so each business&apos;s margin is its industry&apos;s
            margin scaled to its estimated revenue.</p>
        </div>
        <div className="section">
          <h2>3. Revenue from the PPP payroll, combined with step 1</h2>
          <p>PPP loans were sized at 2.5× average monthly payroll (3.5× for second-draw loans to restaurants and
            hotels), so the loan implies an annual payroll. Dividing it by payroll&apos;s share of revenue for companies of
            the same size in the industry (Census Statistics of U.S. Businesses; small firms spend more of their revenue
            on pay) gives a second revenue estimate. When the two are within 3× of each other, the estimate combines
            them (their geometric mean), since each misses in its own way: a headcount mixes in part-timers, and PPP
            payroll leaves out pay over $100,000 a year. Further apart, one is probably wrong and the headcount is used.
            When they differ by more than 2× we mark the estimate low confidence. When a business reported no
            employees, the payroll estimate is used on its own.</p>
        </div>
        <div className="section">
          <h2>Newer headcounts from 401(k) filings</h2>
          <p>Employers with a retirement plan file a Form 5500 with the U.S. Department of Labor every year, reporting
            how many employees are in the plan. We match those filings to listed businesses by name and address and
            chart the yearly count on each profile. When a business has a count from the last two plan years, its
            headline estimate uses that newer figure in place of the 2020 PPP headcount, marked <strong>401(k)
            data</strong>. We keep the older estimate when the plan looks partial: fewer than 3 participants (often
            an owners-only plan), under half the PPP headcount (plans can leave out part-timers and new hires),
            or more than four times it (more often a mismatch or a parent company&apos;s plan).</p>
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
          estimates, not reported financials; PPP-based ones reflect 2019–2020 payroll.</p>
      </main>
      <Footer />
    </>
  );
}
