"""Read-only spot check after a load: a few known businesses, the biggest values, and how estimates are
based. Run via the DB probe workflow (script: spotcheck)."""
import os

import psycopg

url = os.environ["DATABASE_URL"].strip().strip('"').replace("[", "").replace("]", "")
with psycopg.connect(url, connect_timeout=60) as conn, conn.cursor() as cur:
    cur.execute("set statement_timeout = '60s'")
    cur.execute("""select id, name, city, est_method, owner_name, round(est_revenue_mid), round(est_value_mid), est_growth_rate
                   from businesses where name ilike 'cook feed%' or name ilike '%imagenet%' order by est_revenue_mid desc nulls last limit 8""")
    print("id | name | city | basis | owner | revenue | value | growth")
    for r in cur.fetchall():
        print(" | ".join(str(x) for x in r))
    cur.execute("""select coalesce(est_method, '?'), count(*), round(avg(est_revenue_mid)) from businesses
                   where coalesce(est_method, '') <> 'branch' group by 1 order by 2 desc""")
    print("\nbasis | businesses | average revenue")
    for r in cur.fetchall():
        print(" | ".join(str(x) for x in r))
    cur.execute("""select name, city, round(est_value_mid) from businesses where est_value_mid is not null
                   order by est_value_mid desc limit 10""")
    print("\nlargest values:")
    for r in cur.fetchall():
        print(" | ".join(str(x) for x in r))
