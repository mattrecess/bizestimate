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
          <p>Revenue is multiplied by a typical small-business EBITDA margin for the industry.</p>
        </div>
        <div className="section">
          <h2>3. Cross-check from the PPP loan</h2>
          <p>PPP loans were sized at 2.5× average monthly payroll (3.5× for second-draw loans to restaurants and
            hotels), so the loan implies an annual payroll, and dividing by the industry&apos;s payroll-to-revenue ratio
            gives a second revenue estimate. When the two differ by more than 2× we mark the estimate low confidence.
            When a business reported no employees, this payroll method is used instead.</p>
        </div>
        <div className="section">
          <h2>Newer headcounts from 401(k) filings</h2>
          <p>Employers with a retirement plan file a Form 5500 with the U.S. Department of Labor every year, reporting
            how many employees are in the plan. We match those filings to listed businesses by name and address and
            chart the yearly count on each profile. When a business has a count from the last two plan years, its
            headline estimate uses that newer figure in place of the 2020 PPP headcount, marked <strong>401(k)
            data</strong>. We keep the older estimate when the plan looks partial: fewer than 3 participants (often
            an owners-only plan) or under half the PPP headcount, since plans can leave out part-timers and new
            hires.</p>
        </div>
        <div className="section">
          <h2>Businesses without a PPP loan</h2>
          <p>Many businesses never took a PPP loan. We list those from Overture Maps&apos; open business directory
            (skipping any already in the loan data), marked <strong>Industry avg</strong>. With no business-specific
            data, their figures are the typical estimated revenue of PPP businesses in the same industry in Oklahoma:
            the middle value, with a range covering the middle half. They say nothing about that particular business.</p>
        </div>
        <div className="section">
          <h2>Which businesses are listed</h2>
          <p>We only list businesses whose address could be matched to an exact street location by the U.S. Census
            geocoder, so every map pin sits at the business&apos;s own address. Sole proprietors, self-employed
            individuals and independent contractors are not listed, since their address is often a home.</p>
        </div>
        <p className="disclaimer">Source data: SBA PPP FOIA release and DOL Form 5500 filings (public records). All figures are statistical
          estimates, not reported financials; PPP-based ones reflect 2019–2020 payroll. Owners can claim a listing to correct it
          or request removal.</p>
      </main>
      <Footer />
    </>
  );
}
