"""Read-only: business names that appear many times as separate listings (chain kiosks, national brands,
ATMs and the like), with how they're grouped today. Counts and business names only.
Run via the DB probe workflow (script: dup_names)."""
import os

import psycopg

url = os.environ["DATABASE_URL"].strip().strip('"').replace("[", "").replace("]", "")
with psycopg.connect(url, connect_timeout=60) as conn, conn.cursor() as cur:
    cur.execute("""
        select lower(regexp_replace(name, '[^A-Za-z0-9 ]', '', 'g')) as key, min(name), count(*) as n,
               count(*) filter (where coalesce(est_method, '') <> 'branch') as listed,
               count(*) filter (where est_method = 'industry_average') as map_only,
               count(*) filter (where coalesce(total_ppp_amount, 0) > 0) as with_ppp,
               min(naics)
        from businesses where not is_individual
        group by 1 having count(*) >= 8 order by n desc limit 80""")
    print("name | listings | shown in list (not branch) | map-only | with PPP | naics")
    for key, name, n, listed, map_only, ppp, naics in cur.fetchall():
        print(f"{name[:40]:40} | {n:4} | {listed:4} | {map_only:4} | {ppp:3} | {naics}")
