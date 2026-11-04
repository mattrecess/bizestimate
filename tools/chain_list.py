"""Read-only: the listings the chain/kiosk collapse turned into one-per-brand (places_only.collapse_mass_chains),
biggest first, by brand name and Oklahoma location count. Brand names only (the log is public).
Run via the DB probe workflow (script: chain_list)."""
import os

import psycopg

url = os.environ["DATABASE_URL"].strip().strip('"').replace("[", "").replace("]", "")
with psycopg.connect(url, connect_timeout=60) as conn, conn.cursor() as cur:
    cur.execute("select count(*), sum(chain_locations) from businesses where chain_locations > 1")
    print("collapsed brands, locations:", cur.fetchone())
    cur.execute("""select name, chain_locations, coalesce(naics, '') from businesses where chain_locations > 1
                   order by chain_locations desc""")
    for name, n, naics in cur.fetchall():
        print(f"{n:5d}  {naics:6s}  {name}")
