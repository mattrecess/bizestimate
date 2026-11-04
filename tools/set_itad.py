"""One-off (Nov 4, at the owner's request): Vantage Point ITAD is an IT asset disposition business (used IT
equipment bought, wiped and resold or recycled), not a computer wholesaler: recoded to 423930 (recyclable
material merchant wholesalers) the way the /admin NAICS fix does, and 423930 given a 15% EBITDA margin
(the Census wholesale figure fits distributors, not recovery and resale). Applies from the next data load.
Run via the DB probe workflow (script: set_itad)."""
import os

import psycopg

url = os.environ["DATABASE_URL"].strip().strip('"').replace("[", "").replace("]", "")
with psycopg.connect(url, connect_timeout=60) as conn, conn.cursor() as cur:
    cur.execute("select biz_key, name, naics from businesses where id = 1450384")
    key, name, naics = cur.fetchone()
    print("business:", name, naics)
    cur.execute("""insert into naics_overrides (biz_key, naics, source, note, updated_at)
                   values (%s, '423930', 'admin', 'IT asset disposition (recovery and resale), Nov 4', now())
                   on conflict (biz_key) do update set naics = excluded.naics, source = 'admin', note = excluded.note, updated_at = now()""", (key,))
    cur.execute("""insert into industry_overrides (naics_prefix, ebitda_margin, note, updated_at)
                   values ('423930', 0.15, 'Recyclable material & IT asset recovery: 15% EBITDA margin (Nov 4)', now())
                   on conflict (naics_prefix) do update set ebitda_margin = 0.15, updated_at = now()""")
    cur.execute("select naics_prefix, revenue_per_employee, ebitda_margin, multiple from industry_overrides where naics_prefix = '423930'")
    print("industry_overrides:", cur.fetchone())
    cur.execute("select count(*) from businesses where naics like '423930%%' and coalesce(est_method, '') not in ('branch', 'reported', 'verified')")
    print("businesses the margin applies to:", cur.fetchone()[0])
