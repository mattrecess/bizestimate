export const metadata = { title: "How estimates work | BizEstimate" };

export default function Methodology() {
  return (
    <main className="page">
      <h1>How estimates work</h1>
      <div className="section">
        <h2>1. Payroll from PPP loans</h2>
        <p>Paycheck Protection Program loans were sized at 2.5× a business&apos;s average monthly payroll
          (3.5× for second-draw loans to restaurants and hotels, NAICS 72). Reversing that formula gives
          annual payroll: <code>loan ÷ 2.5 × 12</code>. We use the business&apos;s first-draw loan when it has one,
          since it was based on 2019 payroll.</p>
      </div>
      <div className="section">
        <h2>2. Revenue from industry ratios</h2>
        <p>Payroll is divided by the typical payroll-to-revenue ratio for the business&apos;s industry (NAICS code),
          taken from the U.S. Economic Census. Ranges run from 75% to 135% of the midpoint, skewed upward
          because PPP excluded pay above $100,000 per employee.</p>
      </div>
      <div className="section">
        <h2>3. EBITDA from industry margins</h2>
        <p>Revenue is multiplied by a typical small-business EBITDA margin for the industry.</p>
      </div>
      <div className="section">
        <h2>One-person businesses</h2>
        <p>Sole proprietors and self-employed borrowers were sized on owner net profit, not payroll. For them we
          treat the annualized loan as owner earnings and assume a 30% net margin. We never show their street
          address, and map pins are placed at the ZIP code, not the home.</p>
      </div>
      <p className="disclaimer">Source data: SBA PPP FOIA release (public records). All figures are statistical
        estimates, not reported financials, and reflect 2019–2020 payroll. Owners can claim a listing to correct it
        or request removal.</p>
    </main>
  );
}
