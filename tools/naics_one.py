"""Read-only: what the AI industry-code check saw and decided for one business (edit NAME to reuse).
Prints only source names, the website's description of what it does, and the check's outcome: no
contact details (the log is public). Run via the DB probe workflow (script: naics_one)."""
import os

import psycopg

NAME = "%gideon steel%"
url = os.environ["DATABASE_URL"].strip().strip('"').replace("[", "").replace("]", "")
with psycopg.connect(url, connect_timeout=60) as conn, conn.cursor() as cur:
    cur.execute("select biz_key, id, name, naics, to_jsonb(b) ->> 'naics_recorded', est_method from businesses b where name ilike %s", (NAME,))
    rows = cur.fetchall()
    cur.execute("select value from etl_state where key = 'naics_check_cache'")
    cache = (cur.fetchone() or [{}])[0]
    for key, id_, name, naics, recorded, method in rows:
        print(f"\n{name} (id {id_}, {method}): naics {naics}, filed {recorded}")
        cur.execute("select array_agg(source order by source) from business_sources where biz_key = %s", (key,))
        print("  sources:", cur.fetchone()[0])
        cur.execute("""select data ->> 'summary', data -> 'products' from business_sources
                       where biz_key = %s and source = 'website_offering'""", (key,))
        print("  website description:", cur.fetchone())
        print("  check results:", {k: v for k, v in cache.items() if k.startswith(key + "|")} or "none (not checked)")
        cur.execute("select suggested, confidence, reason, status from naics_suggestions where biz_key = %s", (key,))
        print("  review:", cur.fetchall())
        cur.execute("select naics, source, note from naics_overrides where biz_key = %s", (key,))
        print("  correction:", cur.fetchall())
