"""Sanity checks on the loaded data, run after each full load.

    DATABASE_URL=... python etl/checks.py --state OK

Prints a short report and compares it with the previous run's (kept in etl_state). Exits with an
error, which fails the workflow and raises an alert, when something looks broken:
  - the number of listed businesses fell by more than MAX_DROP;
  - median estimated revenue moved by more than MAX_MEDIAN_SHIFT;
  - one city holds more than MAX_CITY_SHARE of the 1,000 highest-revenue businesses (the old
    Tulsa skew);
  - an estimate from PPP figures or industry averages is above MAX_ESTIMATE (reported and verified
    figures, and large employers sized from their 401(k) headcount, can legitimately be bigger);
  - far fewer businesses have an owner, website or phone than last time.
"""
import argparse
import os
import sys

import psycopg

import enrich
from load import database_url

MAX_DROP = 0.10
MAX_MEDIAN_SHIFT = 0.30
MAX_CITY_SHARE = 0.50
MAX_ESTIMATE = 2e9
MAX_FIELD_DROP = 0.25
STATE_KEY = "checks_last"


def metrics(cur, state):
    cur.execute("""
        select count(*),
               percentile_cont(0.5) within group (order by est_revenue_mid) filter (where est_revenue_mid > 0),
               count(*) filter (where coalesce(owner_name, '') <> ''),
               count(*) filter (where coalesce(website, '') <> ''),
               count(*) filter (where coalesce(to_jsonb(b) ->> 'phone', '') <> '' or coalesce(to_jsonb(b) ->> 'site_phone', '') <> ''),
               count(*) filter (where est_revenue_mid > %s and est_method not in ('reported', 'verified', 'retirement_plan'))
        from businesses b where state = %s""", (MAX_ESTIMATE, state))
    total, median, owners, websites, phones, huge = cur.fetchone()
    cur.execute("""
        select city, count(*) from (
          select city from businesses where state = %s and est_revenue_mid is not null
            and coalesce(est_method, '') <> 'branch'
          order by est_revenue_mid desc limit 1000) t
        group by city order by 2 desc limit 1""", (state,))
    top_city, top_count = cur.fetchone() or ("", 0)
    cur.execute("select est_method, count(*) from businesses where state = %s group by 1 order by 2 desc", (state,))
    methods = {m or "": n for m, n in cur.fetchall()}
    cur.execute("""select name, city, est_method, jobs_reported, round(est_revenue_mid / 1e6) from businesses
                   where state = %s and est_revenue_mid > %s order by est_revenue_mid desc limit 15""", (state, MAX_ESTIMATE))
    for name, city, method, jobs, rev in cur.fetchall():
        print(f"Checks: over ${MAX_ESTIMATE / 1e9:.0f}B: {name} ({city}) ${rev:,.0f}M via {method}, {jobs or '?'} PPP jobs", flush=True)
    return {"total": total, "median_revenue": float(median or 0), "owners": owners, "websites": websites,
            "phones": phones, "huge_estimates": huge, "top_city": top_city, "top_city_share": top_count / 1000,
            "methods": methods}


def problems(now, last):
    out = []
    if last.get("total") and now["total"] < (1 - MAX_DROP) * last["total"]:
        out.append(f"listed businesses fell from {last['total']:,} to {now['total']:,}")
    if last.get("median_revenue") and abs(now["median_revenue"] / last["median_revenue"] - 1) > MAX_MEDIAN_SHIFT:
        out.append(f"median revenue moved from ${last['median_revenue']:,.0f} to ${now['median_revenue']:,.0f}")
    if now["top_city_share"] > MAX_CITY_SHARE:
        out.append(f"{now['top_city']} holds {now['top_city_share']:.0%} of the top 1,000 by revenue")
    if now["huge_estimates"]:
        out.append(f"{now['huge_estimates']} estimates above ${MAX_ESTIMATE / 1e9:.0f}B")
    for field in ("owners", "websites", "phones"):
        if last.get(field) and now[field] < (1 - MAX_FIELD_DROP) * last[field]:
            out.append(f"businesses with {field} fell from {last[field]:,} to {now[field]:,}")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", default="OK")
    state = ap.parse_args().state.upper()
    with psycopg.connect(database_url()) as conn, conn.cursor() as cur:
        now = metrics(cur, state)
        last = enrich.state_get(cur, f"{STATE_KEY}_{state}", {})
        found = problems(now, last)
        print(f"Checks: {now['total']:,} businesses, median revenue ${now['median_revenue']:,.0f}, "
              f"owners {now['owners']:,}, websites {now['websites']:,}, phones {now['phones']:,}; "
              f"top-1,000 biggest city {now['top_city']} {now['top_city_share']:.0%}", flush=True)
        print(f"Checks: estimate methods {now['methods']}", flush=True)
        if found:
            # The baseline isn't moved, so a bad load keeps failing until it's fixed (or accepted
            # with CHECKS_ACCEPT=1).
            for p in found:
                print(f"CHECK FAILED: {p}", flush=True)
            if os.environ.get("CHECKS_ACCEPT") != "1":
                sys.exit(1)
        enrich.state_set(cur, f"{STATE_KEY}_{state}", now)
        print("Checks: passed" if not found else "Checks: accepted", flush=True)


if __name__ == "__main__":
    main()
