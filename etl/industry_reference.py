"""Our figures for the most common industries, for the admin page (/admin/industries) to show and edit.

    DATABASE_URL=... python etl/industry_reference.py --state OK

For each of the TOP most common 4-digit NAICS industries among listed businesses: how many there are,
the Census revenue per employee in today's dollars, the IRS EBITDA margin at a few company sizes,
and our sale multiple for a company with about $1M of EBITDA. Rewritten each load (load.py).
"""
import argparse
import json
import os

import psycopg

from adjust import Adjust
from benchmarks import load_benchmarks, lookup
from load import database_url
from margins import Margins

HERE = os.path.dirname(os.path.abspath(__file__))
MULTIPLES = os.path.join(HERE, "..", "web", "lib", "multiples.json")
TOP = 60
REFERENCE_EBITDA = 1_000_000


def multiple_at_reference(naics, m):
    ref = max(mult for floor, mult in m["size"] if floor <= REFERENCE_EBITDA)
    best = (0, 1.0)
    for prefix, f in m["industry"]:
        if naics.startswith(prefix) and len(prefix) > best[0]:
            best = (len(prefix), f)
    return round(ref * best[1], 1)


def refresh(cur, state):
    cur.execute("""create table if not exists industry_reference (
                     naics_prefix text primary key, label text, businesses int, revenue_per_employee numeric,
                     margin_1m numeric, margin_5m numeric, margin_20m numeric, multiple numeric,
                     updated_at timestamptz not null default now())""")
    cur.execute("""select left(naics, 4), count(*) from businesses
                   where state = %s and coalesce(est_method, '') <> 'branch' and not is_individual
                     and length(coalesce(naics, '')) >= 4
                   group by 1 order by 2 desc limit %s""", (state, TOP))
    rows = cur.fetchall()
    bench, margins, adjust = load_benchmarks(), Margins(), Adjust()
    with open(MULTIPLES) as f:
        mult = json.load(f)
    out = []
    for code, n in rows:
        _, b = lookup(bench, code)
        rpe = b.get("revenue_per_employee")
        rpe_now = round(float(rpe) * adjust.inflation(b.get("year"))) if rpe else None
        out.append((code, b.get("label"), n, rpe_now, *(round(margins.margin(code, r), 4) for r in (1e6, 5e6, 2e7)),
                    multiple_at_reference(code, mult)))
    cur.execute("delete from industry_reference")
    cur.executemany("insert into industry_reference (naics_prefix, label, businesses, revenue_per_employee, margin_1m, "
                    "margin_5m, margin_20m, multiple) values (%s, %s, %s, %s, %s, %s, %s, %s)", out)
    print(f"Industry reference: {len(out)} industries for the admin page", flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", default="OK")
    state = ap.parse_args().state.upper()
    with psycopg.connect(database_url()) as conn, conn.cursor() as cur:
        refresh(cur, state)
