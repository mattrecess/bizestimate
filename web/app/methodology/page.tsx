export const metadata = { title: "How estimates work | BizEstimate" };

export default function Methodology() {
  return (
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
        <h2>One-person businesses</h2>
        <p>Sole proprietors and self-employed borrowers who reported no employees were sized on owner net profit, not
          payroll. For them we treat the annualized loan as owner earnings and assume a 30% net margin. We never show their street
          address, and map pins are placed at the ZIP code, not the home.</p>
      </div>
      <p className="disclaimer">Source data: SBA PPP FOIA release (public records). All figures are statistical
        estimates, not reported financials, and reflect 2019–2020 payroll. Owners can claim a listing to correct it
        or request removal.</p>
    </main>
  );
}
