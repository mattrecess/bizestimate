"""Test (Nov 4, approved by the owner): today's employee counts from People Data Labs' company lookup, for
80 businesses whose estimate rests on a 2020 PPP headcount, to see how often PDL matches them and how far
their size has moved since 2020, before deciding on a larger (paid) run. 80 lookups fit PDL's free monthly
allowance; nothing is changed on the site. Results are kept (etl_state 'pdl_company_cache') so a later run
doesn't pay for them twice. Prints company names, headcounts and match rates only (the log is public).
Run via the DB probe workflow (script: pdl_company_test); needs the PDL_API_KEY repository secret."""
import json
import os
import statistics
import sys
import urllib.error
import urllib.parse
import urllib.request

import psycopg

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "etl"))
import enrich  # noqa: E402

N = 80
KEY = os.environ.get("PDL_API_KEY", "").strip()
URL = "https://api.peopledatalabs.com/v5/company/enrich"
STATE = "pdl_company_cache"
if not KEY:
    sys.exit("PDL_API_KEY is not set as a repository secret")

url = os.environ["DATABASE_URL"].strip().strip('"').replace("[", "").replace("]", "")
with psycopg.connect(url, connect_timeout=60) as conn, conn.cursor() as cur:
    cache = enrich.state_get(cur, STATE, {})
    # Lightle and Vantage Point (the owner's examples), then the biggest headcount-based estimates with a website.
    cur.execute("""(select biz_key, name, city, website, jobs_reported, round(est_revenue_mid) from businesses where id in (1312636, 1450384))
                   union all
                   (select biz_key, name, city, website, jobs_reported, round(est_revenue_mid) from businesses
                    where state = 'OK' and est_method in ('blend', 'employees') and website is not null and jobs_reported >= 5
                      and not is_nonprofit and id not in (1312636, 1450384)
                    order by est_revenue_mid desc limit %s)""", (N - 2,))
    rows = cur.fetchall()
    used = 0
    for key, name, city, site, jobs, rev in rows:
        if key in cache:
            continue
        q = {"name": name, "locality": city or "", "region": "oklahoma", "country": "united states", "min_likelihood": 4}
        if site:
            q["website"] = site
        req = urllib.request.Request(f"{URL}?{urllib.parse.urlencode(q)}", headers={"X-Api-Key": KEY})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                d = json.loads(r.read())
            used += 1
            cache[key] = {"employees": d.get("employee_count"), "size": d.get("size"), "likelihood": d.get("likelihood"),
                          "founded": d.get("founded"), "pdl_name": d.get("name")}
        except urllib.error.HTTPError as e:
            if e.code == 404:
                cache[key] = {"employees": None}   # no match (not charged)
            else:
                print(f"PDL {e.code}: {e.read()[:200].decode('utf-8', 'replace')}; stopping")
                break
        enrich.state_set(cur, STATE, cache)
    print(f"PDL company lookups this run (matches, the charged ones): {used}")
    matched, ratios = 0, []
    for key, name, city, site, jobs, rev in rows:
        c = cache.get(key)
        if not c:
            continue
        e = c.get("employees")
        if e:
            matched += 1
            ratios.append(e / jobs)
        print(f"  {name[:40]:40s} {city or '':15s} PPP 2020 jobs {jobs:>5}  PDL today {e if e else '-':>6}  ({c.get('size') or ''})  est rev ${rev:,.0f}")
    print(f"matched {matched} of {len(rows)}")
    if ratios:
        print(f"PDL headcount / 2020 PPP jobs: median {statistics.median(ratios):.2f}, "
              f"under 0.5: {sum(r < 0.5 for r in ratios)}, 0.5-1.5: {sum(0.5 <= r <= 1.5 for r in ratios)}, over 1.5: {sum(r > 1.5 for r in ratios)}")
