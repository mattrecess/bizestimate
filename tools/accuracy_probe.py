"""Backtest: how far our PPP-based revenue methods land from reported revenue (Form 990, SEC), by sector
and size. Read-only; prints aggregates only."""
import math
import os
import statistics as st
from collections import defaultdict

import psycopg

url = os.environ["DATABASE_URL"].strip().strip('"').replace("[", "").replace("]", "")
with psycopg.connect(url) as conn, conn.cursor() as cur:
    cur.execute("""
        select distinct on (b.biz_key) s.source, (s.data ->> 'revenue')::numeric, (s.data ->> 'year')::int,
               b.naics, b.jobs_reported, b.est_revenue_by_employees, b.est_revenue_by_payroll, b.est_payroll,
               (s.data ->> 'ebitda')::numeric, b.est_ebitda_margin
        from business_sources s join businesses b on b.biz_key = s.biz_key
        where s.source in ('irs990', 'sec') and (s.data ->> 'revenue')::numeric > 100000
          and (b.est_revenue_by_employees > 0 or b.est_revenue_by_payroll > 0)
        order by b.biz_key, s.source""")
    rows = cur.fetchall()
print(f"businesses with reported revenue and a PPP-based estimate: {len(rows):,}")

def summary(ratios):
    if not ratios:
        return "n=0"
    logs = [math.log(r) for r in ratios]
    within = sum(1 for r in ratios if 0.67 <= r <= 1.5) / len(ratios)
    return (f"n={len(ratios):4d}  median est/actual {math.exp(st.median(logs)):5.2f}  "
            f"typical miss {math.exp(st.median([abs(x) for x in logs])):4.2f}x  within 1.5x: {within:4.0%}")

methods = {"headcount": [], "payroll": [], "blend": [], "best-of-calibrated": []}
by_sector = defaultdict(lambda: defaultdict(list))
by_size = defaultdict(lambda: defaultdict(list))
for source, actual, year, naics, jobs, by_emp, by_pay, payroll, ebitda, margin in rows:
    actual = float(actual)
    e = float(by_emp) / actual if by_emp else None
    p = float(by_pay) / actual if by_pay else None
    b = math.sqrt(e * p) if e and p and 1 / 3 <= (p / e) <= 3 else e or p
    sector = (naics or "??")[:2]
    band = "<10" if (jobs or 0) < 10 else "10-49" if jobs < 50 else "50-249" if jobs < 250 else "250+"
    for name, r in (("headcount", e), ("payroll", p), ("blend", b)):
        if r:
            methods[name].append(r)
            by_sector[sector][name].append(r)
            by_size[band][name].append(r)

print("\n== all")
for name in ("headcount", "payroll", "blend"):
    print(f"{name:10} {summary(methods[name])}")
print("\n== by sector (blend; then headcount / payroll medians)")
for sector, d in sorted(by_sector.items(), key=lambda kv: -len(kv[1]["blend"])):
    if len(d["blend"]) < 10:
        continue
    med = lambda xs: f"{math.exp(st.median([math.log(x) for x in xs])):5.2f}" if xs else "  -  "  # noqa: E731
    print(f"{sector}  {summary(d['blend'])}   headcount {med(d['headcount'])} payroll {med(d['payroll'])}")
print("\n== by PPP headcount")
for band in ("<10", "10-49", "50-249", "250+"):
    d = by_size[band]
    print(f"{band:7} blend {summary(d['blend'])}")
