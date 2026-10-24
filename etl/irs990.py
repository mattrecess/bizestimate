"""Nonprofits: reported revenue and assets from the IRS Exempt Organizations Business Master File.

    DATABASE_URL=... python etl/irs990.py --state OK

The IRS publishes every tax-exempt organization by state (eo_ok.csv) with the totals from its latest
Form 990: revenue, income and assets, plus the year it was recognized as exempt. Organizations are
matched to listed businesses by name and address; their revenue replaces our estimate.
"""
import argparse
import csv
import io

import psycopg

import enrich
from load import database_url
from matching import match_entities
from netutil import urlopen

URL = "https://www.irs.gov/pub/irs-soi/eo_{state}.csv"
MIN_REVENUE = 50_000   # tiny filers (often 990-N postcards) add noise, not information


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", default="OK")
    state = ap.parse_args().state.upper()
    with urlopen(URL.format(state=state.lower()), timeout=300) as r:
        text = r.read().decode("latin-1")
    orgs = {}
    for row in csv.DictReader(io.StringIO(text)):
        revenue = num(row.get("REVENUE_AMT"))
        if not revenue or revenue < MIN_REVENUE:
            continue
        ein = row["EIN"].strip()
        period = (row.get("TAX_PERIOD") or "").strip()     # YYYYMM of the latest return
        ruling = (row.get("RULING") or "").strip()         # YYYYMM recognized as exempt
        orgs[ein] = {
            "names": {n for n in (row.get("NAME", "").strip(), row.get("SORT_NAME", "").strip()) if n},
            "places": {(row.get("STREET", "").strip(), row.get("CITY", "").strip().upper(), row.get("ZIP", "")[:5])},
            "data": {
                "ein": ein, "name": row.get("NAME", "").strip(), "revenue": revenue,
                "income": num(row.get("INCOME_AMT")), "assets": num(row.get("ASSET_AMT")),
                "year": int(period[:4]) if period[:4].isdigit() else None,
                "exempt_since": int(ruling[:4]) if ruling[:4].isdigit() and ruling[:4] != "0000" else None,
                "ntee": (row.get("NTEE_CD") or "").strip(),
                "url": f"https://projects.propublica.org/nonprofits/organizations/{ein}",
            },
        }
    print(f"irs990: {len(orgs):,} {state} exempt organizations with revenue of ${MIN_REVENUE:,}+", flush=True)
    with psycopg.connect(database_url()) as conn, conn.cursor() as cur:
        biz = enrich.businesses(cur, state)
        matches = match_entities(orgs, biz)
        rows = {}
        for ein, key in matches.items():
            # Two EINs on one business (e.g. a foundation and its operating arm): keep the larger.
            if key not in rows or orgs[ein]["data"]["revenue"] > rows[key]["revenue"]:
                rows[key] = orgs[ein]["data"]
        names = {b["biz_key"]: b["name"] for b in biz}
        for key in list(rows)[:12]:
            print(f"  sample: {names[key]} <- {rows[key]['name']} revenue ${rows[key]['revenue']:,.0f}", flush=True)
        enrich.save(cur, state, "irs990", rows)
        enrich.apply_reported(cur, state)


if __name__ == "__main__":
    main()
