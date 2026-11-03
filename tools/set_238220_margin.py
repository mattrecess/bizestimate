"""One-off (Nov 3, at the owner's request): the admin's EBITDA margin for NAICS 238220 (plumbing, heating
and air-conditioning contractors) is 18%. Same row the /admin/industries form writes; any revenue per
employee or multiple already set for the code is kept. Run via the DB probe workflow (script: set_238220_margin)."""
import os

import psycopg

url = os.environ["DATABASE_URL"].strip().strip('"').replace("[", "").replace("]", "")
with psycopg.connect(url, connect_timeout=60) as conn, conn.cursor() as cur:
    cur.execute("""insert into industry_overrides (naics_prefix, ebitda_margin, note, updated_at)
                   values ('238220', 0.18, 'Plumbing, heating & air: 18% EBITDA margin (owner, Nov 3)', now())
                   on conflict (naics_prefix) do update set ebitda_margin = 0.18,
                     note = coalesce(industry_overrides.note, excluded.note), updated_at = now()""")
    cur.execute("select naics_prefix, revenue_per_employee, ebitda_margin, multiple, note from industry_overrides where naics_prefix = '238220'")
    print("industry_overrides:", cur.fetchone())
