"""Time the live site's API and the database queries behind it, to find why pages hang.

    SITE=https://... DATABASE_URL=... python tools/probe.py
"""
import json
import os
import re
import time
import urllib.request

import psycopg


SITE = os.environ.get("SITE", "https://bizestimate-six.vercel.app")
BBOX = "-98.6,34.9,-96.4,36.1"
PATHS = ["/api/cities", "/api/businesses?sort=revenue_desc&limit=50&offset=0",
         f"/api/businesses?bbox={BBOX}&sort=revenue_desc&limit=50&offset=0",
         "/api/points", f"/api/points?bbox={BBOX}", "/api/businesses?q=septic&limit=6", "/",
         "/api/businesses?q=commercial%20cleaning&limit=8", "/api/businesses?q=janitorial%20tulsa&limit=8",
         "/api/businesses?q=plumbers%20okc&limit=8"]

LIST = """select id, name, est_revenue_mid, coalesce(owner_name, '') <> '' as has_owner,
  coalesce(website, '') <> '' as has_website, count(*) over ()::int as total
  from businesses where true {bbox} order by est_revenue_mid desc nulls last limit 50"""
POINTS = """select id, name, lat, lon, est_revenue_mid, est_method from businesses
  where lat is not null {bbox} order by est_revenue_mid desc nulls last limit 5000"""
BOX = "and lat between 34.9 and 36.1 and lon between -98.6 and -96.4"


def database_url():
    # Same clean-up as etl/load.py: stray quotes and the [ ] Supabase shows around the password.
    url = os.environ["DATABASE_URL"].strip().strip("'\"")
    return re.sub(r"^(\w+://[^:/@]+:)\[(.*)\](@.*)$", r"\1\2\3", url)


def http():
    for p in PATHS:
        t = time.time()
        try:
            with urllib.request.urlopen(urllib.request.Request(SITE + p, headers={"User-Agent": "probe"}), timeout=60) as r:
                body = r.read()
                cache = r.headers.get("x-vercel-cache", "-")
                print(f"{r.status} {time.time() - t:6.2f}s {len(body):>9,}B cdn={cache} {p} {body[:120]!r}", flush=True)
                if "q=" in p and "limit=8" in p:
                    d = json.loads(body)
                    print(f"      total={d['total']} industry={d.get('industry')!r} "
                          f"{[(x['name'], x['naics'], x['city']) for x in d['results']]}", flush=True)
        except Exception as e:  # noqa: BLE001
            print(f"ERR {time.time() - t:6.2f}s {p} {e!r} {getattr(e, 'read', lambda: b'')()[:300]!r}", flush=True)


def db():
    with psycopg.connect(database_url(), autocommit=True) as conn:
        for row in conn.execute("select pid, state, now() - query_start as age, wait_event_type, left(query, 120) "
                                "from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() "
                                "order by age desc nulls last limit 15"):
            print("activity:", row)
        print("rows:", conn.execute("select count(*), pg_size_pretty(pg_total_relation_size('businesses')) from businesses").fetchone())
        if conn.execute("select to_regclass('headcounts')").fetchone()[0]:
            print("headcounts: businesses, rows =", conn.execute(
                "select count(distinct biz_key), count(*) from headcounts").fetchone())
            print("headcounts by year:", conn.execute(
                "select year, count(*), sum(employees) from headcounts group by year order by year").fetchall())
            print("estimates by method and listing source:", conn.execute(
                "select est_method, source, count(*) from businesses group by 1, 2 order by 1, 2").fetchall())
            print("IRS margins applied (method, count with margin, avg margin):", conn.execute(
                "select est_method, count(est_ebitda_margin), round(avg(est_ebitda_margin), 4) from businesses "
                "group by 1 order by 1").fetchall())
            for row in conn.execute("""
                    select id, name, naics, est_revenue_mid::bigint, est_ebitda_mid::bigint, est_ebitda_margin
                    from businesses where est_method = 'retirement_plan' order by random() limit 8"""):
                print("  re-based:", row)
            print("headcounts by listing source:", conn.execute(
                "select b.source, count(distinct b.biz_key) from headcounts h join businesses b using (biz_key) "
                "group by 1").fetchall())
            for row in conn.execute("""
                    select b.id, b.name, b.city, b.jobs_reported, string_agg(h.year || ':' || h.employees, ' ' order by h.year)
                    from headcounts h join businesses b using (biz_key)
                    group by 1, 2, 3, 4 order by random() limit 25"""):
                print("  sample:", row)
        for name, q in [("list all", LIST.format(bbox="")), ("list bbox", LIST.format(bbox=BOX)),
                        ("points all", POINTS.format(bbox="")), ("points bbox", POINTS.format(bbox=BOX))]:
            print(f"--- {name}")
            for (line,) in conn.execute("explain (analyze, buffers) " + q):
                print("  ", line)


if __name__ == "__main__":
    http()
    db()
    http()  # second pass: warm instances
