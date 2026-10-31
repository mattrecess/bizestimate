"""Rebuild the stored "similar businesses nearby" lists on their own (they're also rebuilt in each
data load, etl/map_tables.py). About a minute. Run via the DB probe workflow (script: build_comps)."""
import os
import sys

import psycopg

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "etl"))
import map_tables  # noqa: E402

url = os.environ["DATABASE_URL"].strip().strip('"').replace("[", "").replace("]", "")
with psycopg.connect(url, connect_timeout=60) as conn:
    map_tables.comparables(conn, os.environ.get("STATE", "OK"))
