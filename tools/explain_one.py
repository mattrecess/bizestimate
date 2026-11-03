"""Read-only: every input behind one business's estimate (edit NAME to reuse): figures, method, headcounts,
the industry benchmark and admin figures it used. No contact details (the log is public).
Run via the DB probe workflow (script: explain_one)."""
import os

import psycopg

NAME = "MINICK MATERIALS COMPANY"
url = os.environ["DATABASE_URL"].strip().strip('"').replace("[", "").replace("]", "")
with psycopg.connect(url, connect_timeout=60) as conn, conn.cursor() as cur:
    cur.execute("""select biz_key, id, name, city, naics, industry, est_method, est_confidence, jobs_reported,
                          round(est_revenue_low), round(est_revenue_mid), round(est_revenue_high),
                          round(est_ebitda_low), round(est_ebitda_mid), round(est_ebitda_high), round(est_value_mid),
                          est_ebitda_margin, round(est_payroll), round(est_revenue_by_employees), round(est_revenue_by_payroll),
                          total_ppp_amount, est_inflation, est_growth, est_growth_rate, est_tilt, est_calibration,
                          (select count(*) from businesses c where c.parent_key = b.biz_key) as locations
                   from businesses b where name = %s""", (NAME,))
    cols = [d.name for d in cur.description]
    row = dict(zip(cols, cur.fetchone()))
    for k, v in row.items():
        if k != "biz_key":
            print(f"{k}: {v}")
    cur.execute("select draw, date_approved, amount, jobs_reported from ppp_loans p join businesses b on b.id = p.business_id where b.biz_key = %s", (row["biz_key"],))
    print("PPP loans:", cur.fetchall())
    cur.execute("select year, employees from headcounts where biz_key = %s order by year", (row["biz_key"],))
    print("401(k) headcounts:", cur.fetchall())
    cur.execute("""select naics_prefix, label, revenue_per_employee, payroll_to_revenue, ebitda_margin, source from industry_benchmarks
                   where %s like naics_prefix || '%%' order by length(naics_prefix) desc""", (row["naics"],))
    print("benchmarks:", cur.fetchall())
    cur.execute("select * from industry_overrides where %s like naics_prefix || '%%'", (row["naics"],))
    print("admin industry figures:", cur.fetchall())
    cur.execute("select * from industry_calibration where %s like naics_prefix || '%%'", (row["naics"],))
    print("learned calibration:", cur.fetchall())
    cur.execute("select revenue, ebitda, year, is_public from known_financials where biz_key = %s", (row["biz_key"],))
    print("verified figures on file:", "yes" if cur.fetchone() else "none")
