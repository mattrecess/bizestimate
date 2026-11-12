"""Read-only: how many accounts have signed in with Google, by plan and when (counts only, no names or emails;
the log is public). Run via the DB probe workflow (script: user_count)."""
import os

import psycopg

url = os.environ["DATABASE_URL"].strip().strip('"').replace("[", "").replace("]", "")
with psycopg.connect(url, connect_timeout=60) as conn, conn.cursor() as cur:
    cur.execute("select count(*) from users")
    print("accounts:", cur.fetchone()[0])
    cur.execute("select coalesce(to_jsonb(u) ->> 'plan', 'free'), count(*) from users u group by 1 order by 2 desc")
    print("by plan:", cur.fetchall())
    cur.execute("""select count(*) filter (where created_at > now() - interval '1 day'),
                          count(*) filter (where created_at > now() - interval '7 days'),
                          count(*) filter (where created_at > now() - interval '30 days') from users""")
    print("new in last 1 / 7 / 30 days:", cur.fetchone())
    cur.execute("""select count(*) filter (where (to_jsonb(u) ->> 'last_sign_in')::timestamptz > now() - interval '7 days')
                   from users u""")
    print("signed in during the last 7 days:", cur.fetchone()[0])
    cur.execute("select to_char(created_at, 'YYYY-MM-DD'), count(*) from users group by 1 order by 1")
    print("sign-ups by day:", cur.fetchall())
    for table, label in [("pro_interest", "clicked 'Notify me when Pro opens'"), ("owner_contact_reveals", "contact lookups"),
                         ("owner_search_log", "web searches for owners/executives")]:
        cur.execute("select to_regclass(%s) is not null", (table,))
        if cur.fetchone()[0]:
            cur.execute(f"select count(*) from {table}")
            print(f"{label}:", cur.fetchone()[0])
