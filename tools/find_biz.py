"""Read-only: listings matching a name (edit NAME): id, name, city, owner, method. Run via the DB probe workflow."""
import os

import psycopg

NAME = "%superior building serv%"
url = os.environ["DATABASE_URL"].strip().strip('"').replace("[", "").replace("]", "")
with psycopg.connect(url, connect_timeout=60) as conn, conn.cursor() as cur:
    cur.execute("""select id, name, city, owner_name, est_method, website from businesses where name ilike %s order by id""", (NAME,))
    for r in cur.fetchall():
        print(r)
    cur.execute("""select s.source, s.data from owner_lookups o join businesses b on b.biz_key = o.biz_key
                   left join business_sources s on s.biz_key = b.biz_key and s.source = 'owner_lookup' where b.name ilike %s""", (NAME,))
    print("button searches:", cur.fetchall())
