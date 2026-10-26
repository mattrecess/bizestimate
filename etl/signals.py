"""Score businesses for signs they may sell soon (see enrich.apply_signals). Runs after the other
public-record steps, whose records it reads; load.py also runs it after each data load."""
import argparse

import psycopg

import enrich
from load import database_url

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", default="OK")
    state = ap.parse_args().state.upper()
    with psycopg.connect(database_url()) as conn, conn.cursor() as cur:
        enrich.apply_signals(cur, state)
