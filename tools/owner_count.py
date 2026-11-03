"""Read-only: how many listed businesses have a known owner, overall and by size and source (counts only).
Run via the DB probe workflow (script: owner_count)."""
import os

import psycopg

url = os.environ["DATABASE_URL"].strip().strip('"').replace("[", "").replace("]", "")
with psycopg.connect(url, connect_timeout=60) as conn, conn.cursor() as cur:
    cur.execute("""select count(*), count(*) filter (where coalesce(owner_name, '') <> '')
                   from businesses where not is_individual and coalesce(est_method, '') <> 'branch'""")
    total, owners = cur.fetchone()
    print(f"listed businesses: {total:,}; owner known: {owners:,} ({owners / total:.1%})")
    cur.execute("""select case when est_revenue_mid >= 10e6 then '$10M+' when est_revenue_mid >= 5e6 then '$5-10M'
                                when est_revenue_mid >= 1e6 then '$1-5M' else 'under $1M' end as band,
                           count(*), count(*) filter (where coalesce(owner_name, '') <> '')
                   from businesses where not is_individual and coalesce(est_method, '') <> 'branch' group by 1 order by 1""")
    for band, n, o in cur.fetchall():
        print(f"  revenue {band}: {o:,} of {n:,} ({o / n:.0%})")
    cur.execute("""select case when owner_source is null then 'entered by hand or older pass'
                                when owner_source ilike '%google%' or owner_source ilike '%serper%' then 'web search'
                                else 'company website / web page' end, count(*)
                   from businesses where coalesce(owner_name, '') <> '' group by 1 order by 2 desc""")
    print("by where we found them:", cur.fetchall())
