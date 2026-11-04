"""Read-only: why one business has no website (edit ID). Prints its listing fields and which sources it has
(names only, no contents or contact details; the log is public). Run via the DB probe workflow (script: site_probe)."""
import os

import psycopg

ID = 1450384
url = os.environ["DATABASE_URL"].strip().strip('"').replace("[", "").replace("]", "")
with psycopg.connect(url, connect_timeout=60) as conn, conn.cursor() as cur:
    cur.execute("""select name, address, city, zip, geo_precision, source, website is not null, website, parent_key,
                          round(lat::numeric, 3), round(lon::numeric, 3) from businesses where id = %s""", (ID,))
    print("listing:", cur.fetchone())
    cur.execute("""select s.source from business_sources s join businesses b on b.biz_key = s.biz_key where b.id = %s""", (ID,))
    print("sources:", [r[0] for r in cur.fetchall()])
    cur.execute("""select id, name, city, website is not null, geo_precision, source, est_method from businesses
                   where name ilike '%%vantage point%%' or website ilike '%%vantagepoint%%' order by id""")
    for r in cur.fetchall():
        print("same name:", r)
