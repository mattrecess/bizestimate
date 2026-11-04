"""Read-only: why the 401(k) re-basing (headcount_estimates.apply) finds nothing. Counts only, and Earnheart Oil
as the example (no contact details). Run via the DB probe workflow (script: hc_probe)."""
import os
import sys
from datetime import date

import psycopg

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "etl"))
from calibration import Calibration  # noqa: E402

url = os.environ["DATABASE_URL"].strip().strip('"').replace("[", "").replace("]", "")
with psycopg.connect(url, connect_timeout=60) as conn, conn.cursor() as cur:
    since = date.today().year - 2
    for label, extra in [("joined", ""), ("state OK", "and b.state = 'OK'"), ("min 3", "and b.state = 'OK' and l.employees >= 3"),
                         ("method ok", "and b.state = 'OK' and l.employees >= 3 and coalesce(b.est_method, '') not in ('reported', 'verified', 'branch')")]:
        cur.execute(f"""with latest as (select distinct on (biz_key) biz_key, employees, naics, year from headcounts
                        where source = 'form5500' and year >= %s order by biz_key, year desc)
                        select count(*) from businesses b join latest l on l.biz_key = b.biz_key where true {extra}""", (since,))
        print(label, cur.fetchone()[0])
    cur.execute("select b.state, b.est_method, b.jobs_reported, pg_typeof(h.employees)::text, h.employees, h.year from businesses b join headcounts h on h.biz_key = b.biz_key where b.id = 1298749 order by h.year desc limit 1")
    print("Earnheart:", cur.fetchone())
    cal = Calibration(cur)
    print("simple:", cal.simple("424720", 141.0, date(2024, 12, 31)))
