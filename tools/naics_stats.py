"""Read-only: how the AI industry-code check's cached answers break down (counts only).
Run via the DB probe workflow (script: naics_stats)."""
import os
from collections import Counter

import psycopg

url = os.environ["DATABASE_URL"].strip().strip('"').replace("[", "").replace("]", "")
with psycopg.connect(url, connect_timeout=60) as conn, conn.cursor() as cur:
    cur.execute("select value from etl_state where key = 'naics_check_cache'")
    cache = (cur.fetchone() or [{}])[0]
    print("cached answers:", len(cache))
    print("by outcome:", Counter("unusable" if not v else v.get("confidence") for v in cache.values()))
