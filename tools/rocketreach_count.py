"""Read-only: how many saved RocketReach lookups remain (counts only, no personal data).
Run via the DB probe workflow (script: rocketreach_count)."""
import os

import psycopg

url = os.environ["DATABASE_URL"].strip().strip('"').replace("[", "").replace("]", "")
with psycopg.connect(url, connect_timeout=60) as conn, conn.cursor() as cur:
    cur.execute("select to_regclass('contact_lookups') is not null")
    if not cur.fetchone()[0]:
        print("contact_lookups: no table")
    else:
        cur.execute("select provider, count(*) from contact_lookups group by 1")
        print("contact_lookups by provider:", cur.fetchall())
    cur.execute("select count(*) from business_sources where data::text ilike '%rocketreach%'")
    print("other saved records mentioning RocketReach:", cur.fetchone()[0])
    cur.execute("""select source, count(*) from business_sources where data::text ilike '%rocketreach%' group by 1 order by 2 desc""")
    print("by source:", cur.fetchall())
    cur.execute("select count(*) from businesses where coalesce(to_jsonb(businesses) ->> 'owner_source', '') ilike '%rocketreach%'")
    print("owners whose cited source is a RocketReach page:", cur.fetchone()[0])

