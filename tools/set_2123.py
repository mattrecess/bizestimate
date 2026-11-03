"""One-off (Nov 3, at the owner's request): sand, gravel and stone quarrying (NAICS 2123): $650K revenue per
employee in today's dollars, in place of the Census figure (equipment-heavy quarries run on few people).
Same row the /admin/industries form writes; other figures set for the code are kept.
Run via the DB probe workflow (script: set_2123)."""
import os

import psycopg

url = os.environ["DATABASE_URL"].strip().strip('"').replace("[", "").replace("]", "")
with psycopg.connect(url, connect_timeout=60) as conn, conn.cursor() as cur:
    cur.execute("""insert into industry_overrides (naics_prefix, revenue_per_employee, note, updated_at)
                   values ('2123', 650000, 'Sand, gravel & stone: $650K revenue/employee (equipment-heavy; Nov 3)', now())
                   on conflict (naics_prefix) do update set revenue_per_employee = 650000, updated_at = now()""")
    cur.execute("select naics_prefix, revenue_per_employee, ebitda_margin, multiple from industry_overrides where naics_prefix = '2123'")
    print("industry_overrides:", cur.fetchone())
    cur.execute("select count(*) from businesses where naics like '2123%%' and coalesce(est_method, '') not in ('branch', 'reported', 'verified')")
    print("businesses this applies to:", cur.fetchone()[0])
