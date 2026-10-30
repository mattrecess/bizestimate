"""The figures the site uses for Oklahoma's most common industries: business count, revenue per employee
(Census benchmark), EBITDA margin (IRS, at a few company sizes) and our sale multiple at ~$1M EBITDA.
Read-only. Run from the repo root with etl/ on the path."""
import json
import os
import sys

sys.path.insert(0, "etl")
import psycopg  # noqa: E402

from benchmarks import load_benchmarks, lookup  # noqa: E402
from margins import Margins  # noqa: E402

url = os.environ["DATABASE_URL"].strip().strip('"').replace("[", "").replace("]", "")
mult = json.load(open("web/lib/multiples.json"))
ref = max(m for f, m in mult["size"] if f <= 1_000_000)


def multiple(naics):
    best = (0, 1.0)
    for p, f in mult["industry"]:
        if naics.startswith(p) and len(p) > best[0]:
            best = (len(p), f)
    return round(ref * best[1], 1)


bench, margins = load_benchmarks(), Margins()
with psycopg.connect(url, connect_timeout=60) as conn, conn.cursor() as cur:
    cur.execute("""select left(naics, 4) as code, count(*) from businesses
                   where coalesce(est_method, '') <> 'branch' and not is_individual and length(coalesce(naics, '')) >= 4
                   group by 1 order by 2 desc limit 30""")
    rows = cur.fetchall()
print(f"{'NAICS':6} {'industry':44} {'listed':>7} {'rev/emp':>9} {'margin@$1M':>10} {'@$5M':>6} {'@$20M':>6} {'mult@$1M':>8}")
for code, n in rows:
    key, b = lookup(bench, code)
    rpe = b.get("revenue_per_employee")
    m = [margins.margin(code, r) for r in (1e6, 5e6, 2e7)]
    print(f"{code:6} {b.get('label', '')[:44]:44} {n:7,} {('$' + format(round(rpe / 1000), ',') + 'K') if rpe else '-':>9} "
          f"{m[0]:10.1%} {m[1]:6.1%} {m[2]:6.1%} {multiple(code):7.1f}x")
