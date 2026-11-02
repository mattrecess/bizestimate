"""Read-only: a sample of the AI industry-code corrections and review items, to sanity-check them.
Run via the DB probe workflow (script: naics_sample)."""
import json
import os

import psycopg

url = os.environ["DATABASE_URL"].strip().strip('"').replace("[", "").replace("]", "")
titles = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web", "public", "naics2022.json")))
t = lambda c: titles.get(c or "", "?")[:45]  # noqa: E731
with psycopg.connect(url, connect_timeout=60) as conn, conn.cursor() as cur:
    cur.execute("""select b.name, b.naics_recorded, o.naics, o.note from naics_overrides o join businesses b on b.biz_key = o.biz_key
                   where b.name ilike '%gideon steel%' or b.name ilike 'imagenet%' or b.name ilike 'earnheart%'""")
    for r in cur.fetchall():
        print(f"CHECK {r[0]}: {r[1]} {t(r[1])} -> {r[2]} {t(r[2])} | {r[3]}")
    cur.execute("""select b.name, b.naics_recorded, o.naics, o.note, b.est_revenue_mid from naics_overrides o
                   join businesses b on b.biz_key = o.biz_key where o.source = 'ai'
                   order by b.est_revenue_mid desc nulls last limit 15""")
    print("\nlargest AI corrections:")
    for r in cur.fetchall():
        print(f"  {r[0][:38]}: {r[1]} {t(r[1])} -> {r[2]} {t(r[2])} | {r[3]}")
    cur.execute("""select left(b.naics_recorded, 2) = left(o.naics, 2), count(*) from naics_overrides o
                   join businesses b on b.biz_key = o.biz_key where o.source = 'ai' group by 1""")
    print("\nsame sector (first 2 digits)?", cur.fetchall())
    cur.execute("""select b.name, s.filed, s.suggested, s.reason from naics_suggestions s join businesses b on b.biz_key = s.biz_key
                   where s.status = 'open' order by b.est_revenue_mid desc nulls last limit 8""")
    print("\nlargest review items:")
    for r in cur.fetchall():
        print(f"  {r[0][:38]}: {r[1]} {t(r[1])} -> {r[2]} {t(r[2])} | {r[3]}")
