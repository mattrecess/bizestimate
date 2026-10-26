"""Apply db/schema.sql (idempotent) at the start of a data load, so the website can rely on new
columns long before the slow steps finish and load.py runs.

`alter table` needs a brief exclusive lock. While another job holds the table (e.g. the Public
records workflow), waiting for it would also queue every page request behind us, so each attempt
gives up after a few seconds and tries again, for up to MAX_WAIT_MIN minutes.
"""
import os
import time

import psycopg

from load import ROOT, database_url

LOCK_TIMEOUT = "5s"
MAX_WAIT_MIN = 30

if __name__ == "__main__":
    with open(os.path.join(ROOT, "db", "schema.sql")) as f:
        schema = f.read()
    deadline = time.time() + MAX_WAIT_MIN * 60
    attempt = 0
    while True:
        attempt += 1
        try:
            with psycopg.connect(database_url()) as conn:
                conn.execute(f"set lock_timeout = '{LOCK_TIMEOUT}'")
                conn.execute("set statement_timeout = '10min'")
                conn.execute(schema)
            break
        except (psycopg.errors.LockNotAvailable, psycopg.errors.DeadlockDetected,
                psycopg.errors.QueryCanceled) as e:
            if time.time() > deadline:
                raise
            print(f"Schema: table busy ({type(e).__name__}), retrying (attempt {attempt})", flush=True)
            time.sleep(min(60, 5 * attempt))
    print("Schema applied", flush=True)
