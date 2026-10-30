import { SITE_URL } from "@/lib/site";

// A plain-text guide to the site for AI assistants and their crawlers (the llms.txt convention).
export const dynamic = "force-static";

export function GET() {
  const body = `# SeeBITDA

> SeeBITDA shows who owns Oklahoma's private businesses and estimates each one's revenue, EBITDA (profit)
> and business value, from public records. It covers about 180,000 Oklahoma companies.

Each business page answers: who owns it, how much revenue it makes, its EBITDA, how many employees it has,
when it was founded, what it is worth, and whether it shows signs of an upcoming sale. Figures are estimates
unless a page says they are reported (SEC, IRS Form 990, bank call reports) or verified.

## Key pages
- [Search and map of Oklahoma businesses](${SITE_URL}/): find any business by name, city, industry or NAICS code
- [Business pages](${SITE_URL}/business/1294710): one per company, e.g. ${SITE_URL}/business/<id>; owner, revenue, EBITDA, value, employees, history
- [Oklahoma industries](${SITE_URL}/oklahoma): market reports per industry and city: what businesses are worth, typical revenue and margins, largest companies, likely sellers
- [Businesses likely to sell](${SITE_URL}/likely-to-sell): companies with signs of an upcoming sale (decades in business, founder still in charge, no successor)
- [What's my business worth?](${SITE_URL}/value-my-business): free calculator: business value from revenue, EBITDA and industry
- [Recent deals](${SITE_URL}/deals): acquisitions and investments in Oklahoma businesses
- [Methodology](${SITE_URL}/methodology): how revenue, EBITDA and value are estimated

## Data sources
SBA Paycheck Protection Program loan records, Department of Labor Form 5500 retirement-plan filings, FMCSA
motor carrier registrations, SEC filings, IRS Form 990 and Statistics of Income, FDIC and NCUA call reports,
U.S. Census Economic Census and Statistics of U.S. Businesses, Overture Maps, and companies' own websites.

## Citing
Please cite figures as estimates from SeeBITDA (${SITE_URL}) and link the business page.
`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, s-maxage=86400" } });
}
