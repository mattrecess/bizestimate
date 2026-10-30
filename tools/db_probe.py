"""Time the site's list and map requests for a city-sized view, and show the database's plan for the list.

Read-only: EXPLAIN ANALYZE of SELECTs and timed HTTP requests to the live site.
"""
import os
import time
import urllib.request

import psycopg

SITE = "https://www.seebitda.com"
BOXES = {"OKC": (-97.75, 35.35, -97.35, 35.6), "Tulsa": (-96.1, 36.0, -95.8, 36.25)}

for name, (w, s, e, n) in BOXES.items():
    box = f"{w},{s},{e},{n}"
    for path in (f"/api/points?bbox={box}", f"/api/businesses?bbox={box}&limit=50", f"/api/businesses?bbox={box}&limit=50&sort=value_desc"):
        for attempt in (1, 2):
            t = time.time()
            try:
                urllib.request.urlopen(f"{SITE}{path}&probe={time.time()}", timeout=120).read()
                print(f"{name} try {attempt}: {time.time() - t:5.2f}s {path}", flush=True)
            except Exception as ex:  # noqa: BLE001
                print(f"{name} try {attempt}: FAILED {ex!r} {path}", flush=True)

url = os.environ["DATABASE_URL"].strip().strip('"').replace("[", "").replace("]", "")
with psycopg.connect(url) as conn, conn.cursor() as cur:
    w, s, e, n = BOXES["OKC"]
    where = f"lat between {s} and {n} and lon between {w} and {e} and not is_individual and coalesce(est_method, '') <> 'branch'"
    for label, q in [
        ("list page", f"""select id, name, (select count(*)::int from businesses c where c.parent_key = businesses.biz_key) as locations
            from businesses where {where} order by est_revenue_mid desc nulls last, id limit 50"""),
        ("count", f"select count(*) from businesses where {where}"),
        ("points-like", f"select id, lat, lon, est_revenue_mid from businesses where lat between {s} and {n} and lon between {w} and {e} order by est_revenue_mid desc nulls last limit 3000"),
    ]:
        cur.execute("explain (analyze, buffers) " + q)
        print(f"\n== {label}")
        for (line,) in cur.fetchall():
            print(line)
    cur.execute("select pg_size_pretty(pg_total_relation_size('businesses')), (select count(*) from businesses)")
    print("\nbusinesses table:", cur.fetchone())
