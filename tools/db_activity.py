"""What is the database busy with? Read-only: active queries, their age and wait state."""
import os

import psycopg

url = os.environ["DATABASE_URL"].strip().strip('"').replace("[", "").replace("]", "")
with psycopg.connect(url, connect_timeout=60) as conn, conn.cursor() as cur:
    cur.execute("""select pid, usename, application_name, state, wait_event_type, wait_event,
                          now() - query_start as running_for, left(regexp_replace(query, '\\s+', ' ', 'g'), 160)
                   from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()
                   order by query_start nulls last""")
    for row in cur.fetchall():
        print(row, flush=True)
    cur.execute("select count(*) filter (where state = 'active'), count(*) from pg_stat_activity")
    print("active / total connections:", cur.fetchone())
