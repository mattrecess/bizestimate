"""Load data/businesses.csv, data/loans.csv and benchmarks into Postgres (e.g. Supabase).

    DATABASE_URL=postgresql://... python etl/load.py --state OK

Only businesses geocoded to their street address are loaded.
Re-running updates that state's businesses in place (matched on biz_key), so their ids,
and therefore their page URLs, stay the same; businesses no longer in the data are removed.
"""
import argparse
import csv
import os
import re
import time
from urllib.parse import unquote, urlparse

import psycopg

import enrich
import headcount_estimates
from benchmarks import load_benchmarks

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
DATA_DIR = os.path.join(ROOT, "data")

BIZ_COLS = [
    "biz_key", "name", "address", "city", "state", "zip", "county", "naics", "industry",
    "business_type", "is_individual", "is_nonprofit", "jobs_reported", "lat", "lon",
    "geo_precision", "est_payroll", "est_revenue_low", "est_revenue_mid", "est_revenue_high",
    "est_ebitda_low", "est_ebitda_mid", "est_ebitda_high", "est_revenue_by_employees", "est_revenue_by_payroll",
    "est_method", "est_confidence", "total_ppp_amount", "website", "owner_name", "owner_title", "owner_source",
    "source", "est_ebitda_margin", "est_inflation", "est_growth", "parent_key", "parent_name",
    "phone", "site_phone", "site_email", "contact_page",
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
        # The database's default statement limit is sized for page requests; a load that touches
        # every row (e.g. after new columns are added) needs longer. Readers aren't blocked meanwhile.
        cur.execute("set statement_timeout = '45min'")
        # Schema changes need a brief exclusive lock; if another job holds the table, retry in short
        # attempts rather than queue page requests behind a long wait.
        with open(os.path.join(ROOT, "db", "schema.sql")) as f:
            schema = f.read()
        for attempt in range(1, 61):
            try:
                with conn.transaction():
                    cur.execute("set local lock_timeout = '5s'")
                    cur.execute(schema)
                break
            except (psycopg.errors.LockNotAvailable, psycopg.errors.DeadlockDetected) as e:
                if attempt == 60:
                    raise
                print(f"Schema: table busy ({type(e).__name__}), retrying", flush=True)
                time.sleep(30)
        # Commit now: schema changes lock the table, and the load below runs in one long transaction
        # that would otherwise hold that lock (blocking pages and other jobs) until it finishes.
        conn.commit()

        cur.execute("delete from industry_benchmarks")
        cur.executemany(
            "insert into industry_benchmarks values (%s,%s,%s,%s,%s,%s)",
            [(p, b["label"], b["payroll_to_revenue"], b["revenue_per_employee"],
              b["ebitda_margin"], b["source"]) for p, b in load_benchmarks().items()],
        )

        cur.execute(f"create temp table stage_biz ({', '.join(c + ' text' for c in BIZ_COLS)})")
        with cur.copy(f"copy stage_biz ({', '.join(BIZ_COLS)}) from stdin") as cp:
            for r in rows(os.path.join(DATA_DIR, "businesses.csv"), BIZ_COLS):
                cp.write_row(r)
        # Only list businesses pinned at their own geocoded street address; ZIP-level placements
        # (sole proprietors, whose addresses we never geocode, and addresses the Census couldn't
        # match) are left out, which also removes any already loaded.
        cur.execute("delete from stage_biz where geo_precision is null "
                    "or geo_precision not in ('rooftop', 'place', 'building', 'address') "
                    "or coalesce(address, '') = ''")
        print(f"skipped without a street-level address: {cur.rowcount:,}")
        # Safety net: a truncated input file must never wipe the site. Refuse to shrink a state's
        # listings by more than 30% unless LOAD_ALLOW_SHRINK=1.
        cur.execute("select count(*) from stage_biz")
        staged = cur.fetchone()[0]
        cur.execute("select count(*) from businesses where state = %s", (state,))
        existing = cur.fetchone()[0]
        if existing and staged < 0.7 * existing and os.environ.get("LOAD_ALLOW_SHRINK") != "1":
            raise SystemExit(f"Refusing to load: {staged:,} businesses would replace {existing:,} "
                             f"(more than a 30% drop). Set LOAD_ALLOW_SHRINK=1 if that's intended.")
        casts = {
            "is_individual": "coalesce(is_individual::boolean, false)",
            "is_nonprofit": "coalesce(is_nonprofit::boolean, false)",
            "jobs_reported": "jobs_reported::numeric::int",
            "lat": "lat::float8", "lon": "lon::float8",
        }
        numeric = {c for c in BIZ_COLS if c.startswith(("est_", "total_"))} - {"est_method", "est_confidence"}
        select = ", ".join(casts.get(c) or (f"{c}::numeric" if c in numeric else c) for c in BIZ_COLS)
        cols = [c for c in BIZ_COLS if c != "biz_key"]
        updates = ", ".join(f"{c} = excluded.{c}" for c in cols)
        # Only rewrite rows that changed: rewriting all of them every day bloats the table and
        # leaves the database busy vacuuming, which made the site hang for minutes after a load.
        changed = (f"({', '.join('businesses.' + c for c in cols)}) is distinct from "
                   f"({', '.join('excluded.' + c for c in cols)})")
        cur.execute(f"insert into businesses ({', '.join(BIZ_COLS)}) "
                    f"select distinct on (biz_key) {select} from stage_biz "
                    f"on conflict (biz_key) do update set {updates} where {changed}")
        print(f"businesses added or changed: {cur.rowcount:,}")
        cur.execute("delete from businesses b where state = %s "
                    "and not exists (select 1 from stage_biz s where s.biz_key = b.biz_key)", (state,))
        print(f"businesses removed: {cur.rowcount:,}")

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
            on conflict (loan_number) do update set business_id = excluded.business_id,
                draw = excluded.draw, date_approved = excluded.date_approved, amount = excluded.amount,
                payroll_proceed = excluded.payroll_proceed, forgiveness_amount = excluded.forgiveness_amount,
                loan_status = excluded.loan_status, lender = excluded.lender,
                jobs_reported = excluded.jobs_reported
            where (ppp_loans.business_id, ppp_loans.draw, ppp_loans.date_approved, ppp_loans.amount,
                   ppp_loans.payroll_proceed, ppp_loans.forgiveness_amount, ppp_loans.loan_status,
                   ppp_loans.lender, ppp_loans.jobs_reported)
              is distinct from (excluded.business_id, excluded.draw, excluded.date_approved, excluded.amount,
                   excluded.payroll_proceed, excluded.forgiveness_amount, excluded.loan_status,
                   excluded.lender, excluded.jobs_reported)""")
        print(f"ppp_loans added or changed: {cur.rowcount:,}")
        # Newer Form 5500 headcounts override the PPP-era estimate; a failure here must not undo the load.
        try:
            with conn.transaction():
                headcount_estimates.apply(cur, state.upper())
        except psycopg.Error as e:
            print(f"Re-basing on retirement-plan headcounts failed (non-fatal): {e}", flush=True)
        # Reported figures (SEC, bank call reports, Form 990) beat any estimate.
        try:
            with conn.transaction():
                enrich.apply_reported(cur, state.upper())
        except psycopg.Error as e:
            print(f"Applying reported financials failed (non-fatal): {e}", flush=True)
        try:
            with conn.transaction():
                enrich.apply_known(cur, state.upper())
        except psycopg.Error as e:
            print(f"Applying verified figures failed (non-fatal): {e}", flush=True)
        try:
            with conn.transaction():
                enrich.apply_owners(cur, state.upper())
        except psycopg.Error as e:
            print(f"Filling owners failed (non-fatal): {e}", flush=True)
        try:
            with conn.transaction():
                enrich.apply_lenders(cur, state.upper())
        except psycopg.Error as e:
            print(f"Lender links failed (non-fatal): {e}", flush=True)
        try:
            with conn.transaction():
                enrich.apply_signals(cur, state.upper())
        except psycopg.Error as e:
            print(f"Sell signals failed (non-fatal): {e}", flush=True)
        cur.execute("analyze businesses; analyze ppp_loans;")


if __name__ == "__main__":
    main()
