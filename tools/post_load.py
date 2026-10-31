"""The data load's final steps on their own (etl/load.py runs them after each load): vacuum, stored
values, map tables, similar businesses and the industry reference table. For when a load saved its
estimates but stopped before these. Run via the DB probe workflow (script: post_load)."""
import os
import sys

import psycopg

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "etl"))
import industry_reference  # noqa: E402
import map_tables  # noqa: E402

url = os.environ["DATABASE_URL"].strip().strip('"').replace("[", "").replace("]", "")
state = os.environ.get("STATE", "OK")
with psycopg.connect(url, autocommit=True, connect_timeout=60) as vac:
    vac.execute("vacuum (analyze) businesses")
    print("Vacuum: done", flush=True)
with psycopg.connect(url, connect_timeout=60) as conn:
    map_tables.refresh(conn, state)
with psycopg.connect(url, connect_timeout=60) as conn, conn.cursor() as cur:
    industry_reference.refresh(cur, state)
    conn.commit()
print("Post-load steps: done", flush=True)
