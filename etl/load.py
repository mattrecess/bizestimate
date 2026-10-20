"""Load data/businesses.csv, data/loans.csv and benchmarks into Postgres (e.g. Supabase).

    DATABASE_URL=postgresql://... python etl/load.py --state OK

Re-running replaces that state's businesses (and their loans) atomically.
"""
import argparse
import csv
import os
import re
from urllib.parse import unquote, urlparse

import psycopg

from benchmarks import load_benchmarks

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
DATA_DIR = os.path.join(ROOT, "data")

BIZ_COLS = [
    "biz_key", "name", "address", "city", "state", "zip", "county", "naics", "industry",
    "business_type", "is_individual", "is_nonprofit", "jobs_reported", "lat", "lon",
    "geo_precision", "est_payroll", "est_revenue_low", "est_revenue_mid", "est_revenue_high",
    "est_ebitda_low", "est_ebitda_mid", "est_ebitda_high", "est_revenue_by_employees",
    "est_method", "est_confidence", "total_ppp_amount",
]
LOAN_COLS = ["loan_number", "biz_key", "draw", "date_approved", "amount", "payroll_proceed",
             "forgiveness_amount", "loan_status", "lender", "jobs_reported"]


def rows(path, cols):
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            yield [r.get(c) or None for c in cols]


def database_url():
    """Read DATABASE_URL, trim copy-paste debris, and print its shape (never the password)."""
    url = os.environ["DATABASE_URL"].strip().strip('"').strip("'").strip()
    # Supabase shows the password slot as [YOUR-PASSWORD]; the brackets are often left in.
    m = re.match(r"^(\w+://[^:/@]+:)\[(.*)\](@.*)$", url)
    if m:
        print("Note: removed [ ] around the password in DATABASE_URL", flush=True)
        url = m.group(1) + m.group(2) + m.group(3)
    try:
        u = urlparse(url)
        pw = unquote(u.password or "")
        flags = [name for name, bad in [
            ("brackets", "[" in pw or "]" in pw),
            ("placeholder text", "YOUR-PASSWORD" in pw.upper()),
            ("whitespace", any(c.isspace() for c in pw)),
            ("non-alphanumeric chars", not pw.isalnum()),
        ] if bad]
        print(f"DB: user={u.username} host={u.hostname} port={u.port} db={u.path.lstrip('/')} "
              f"password_length={len(pw)} issues={flags or 'none'}", flush=True)
    except ValueError as e:
        print(f"DATABASE_URL is not a valid URL: {e}", flush=True)
    return url


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", default="OK")
    state = ap.parse_args().state.upper()

    with psycopg.connect(database_url()) as conn, conn.cursor() as cur:
        with open(os.path.join(ROOT, "db", "schema.sql")) as f:
            cur.execute(f.read())

        cur.execute("delete from industry_benchmarks")
        cur.executemany(
            "insert into industry_benchmarks values (%s,%s,%s,%s,%s,%s)",
            [(p, b["label"], b["payroll_to_revenue"], b["revenue_per_employee"],
              b["ebitda_margin"], b["source"]) for p, b in load_benchmarks().items()],
        )

        cur.execute("delete from businesses where state = %s", (state,))
        cur.execute(f"create temp table stage_biz ({', '.join(c + ' text' for c in BIZ_COLS)})")
        with cur.copy(f"copy stage_biz ({', '.join(BIZ_COLS)}) from stdin") as cp:
            for r in rows(os.path.join(DATA_DIR, "businesses.csv"), BIZ_COLS):
                cp.write_row(r)
        casts = {
            "is_individual": "coalesce(is_individual::boolean, false)",
            "is_nonprofit": "coalesce(is_nonprofit::boolean, false)",
            "jobs_reported": "jobs_reported::numeric::int",
            "lat": "lat::float8", "lon": "lon::float8",
        }
        numeric = {c for c in BIZ_COLS if c.startswith(("est_", "total_"))} - {"est_method", "est_confidence"}
        select = ", ".join(casts.get(c) or (f"{c}::numeric" if c in numeric else c) for c in BIZ_COLS)
        cur.execute(f"insert into businesses ({', '.join(BIZ_COLS)}) "
                    f"select {select} from stage_biz on conflict (biz_key) do nothing")
        print(f"businesses: {cur.rowcount:,}")

        cur.execute(f"create temp table stage_loans ({', '.join(c + ' text' for c in LOAN_COLS)})")
        with cur.copy(f"copy stage_loans ({', '.join(LOAN_COLS)}) from stdin") as cp:
            for r in rows(os.path.join(DATA_DIR, "loans.csv"), LOAN_COLS):
                cp.write_row(r)
        cur.execute("""
            insert into ppp_loans (loan_number, business_id, draw, date_approved, amount,
                payroll_proceed, forgiveness_amount, loan_status, lender, jobs_reported)
            select distinct on (s.loan_number) s.loan_number, b.id, s.draw, s.date_approved::date,
                s.amount::numeric, s.payroll_proceed::numeric, s.forgiveness_amount::numeric,
                s.loan_status, s.lender, s.jobs_reported::numeric::int
            from stage_loans s join businesses b on b.biz_key = s.biz_key
            on conflict (loan_number) do nothing""")
        print(f"ppp_loans: {cur.rowcount:,}")
        cur.execute("analyze businesses; analyze ppp_loans;")


if __name__ == "__main__":
    main()
