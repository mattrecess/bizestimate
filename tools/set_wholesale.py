"""One-off (Nov 3, at the owner's request): wholesale figures. All wholesalers (NAICS 42): $550K revenue per
employee in today's dollars (Census wholesale figures, dominated by big distributors, put small Oklahoma
wholesalers at about 3x their real revenue: Minick Materials ~$17M actual vs $52M estimated). Building-material
distributors (4233): 10% EBITDA margin. Same rows the /admin/industries form writes; other figures already
set for these codes are kept. Run via the DB probe workflow (script: set_wholesale)."""
import os

import psycopg

url = os.environ["DATABASE_URL"].strip().strip('"').replace("[", "").replace("]", "")
with psycopg.connect(url, connect_timeout=60) as conn, conn.cursor() as cur:
    cur.execute("""insert into industry_overrides (naics_prefix, revenue_per_employee, note, updated_at)
                   values ('42', 550000, 'Wholesale: $550K revenue/employee (Census figures ~3x too high for small OK wholesalers; Nov 3)', now())
                   on conflict (naics_prefix) do update set revenue_per_employee = 550000, updated_at = now()""")
    cur.execute("""insert into industry_overrides (naics_prefix, ebitda_margin, note, updated_at)
                   values ('4233', 0.10, 'Building-material distributors: 10% EBITDA margin (Nov 3)', now())
                   on conflict (naics_prefix) do update set ebitda_margin = 0.10, updated_at = now()""")
    cur.execute("select naics_prefix, revenue_per_employee, ebitda_margin, multiple from industry_overrides where naics_prefix in ('42', '4233')")
    print("industry_overrides:", cur.fetchall())
    cur.execute("""select count(*) from businesses where naics like '42%%' and coalesce(est_method, '') not in ('branch', 'reported', 'verified')""")
    print("wholesale businesses these apply to:", cur.fetchone()[0])
