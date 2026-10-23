"""Apply db/schema.sql (idempotent) at the start of a data load, so the website can rely on new
columns long before the slow steps finish and load.py runs."""
import os

import psycopg

from load import ROOT, database_url

if __name__ == "__main__":
    with psycopg.connect(database_url()) as conn, open(os.path.join(ROOT, "db", "schema.sql")) as f:
        conn.execute(f.read())
    print("Schema applied", flush=True)
