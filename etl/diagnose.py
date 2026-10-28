"""Explain why specific businesses are or aren't listed.

    python etl/diagnose.py --state OK

Reads names from etl/lookup.txt (one per line, matched case-insensitively as a substring of the
PPP borrower name) and prints every matching PPP borrower with the reason it is or isn't on the map.
"""
import argparse
import csv
import os

from build import norm_name

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "..", "data")
LISTED = {"rooftop", "place", "building", "address", "zip"}   # zip: listed at an approximate location


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", default="OK")
    state = ap.parse_args().state.lower()
    with open(os.path.join(HERE, "lookup.txt")) as f:
        queries = [q.strip().upper() for q in f if q.strip() and not q.startswith("#")]
    if not queries:
        return
    with open(os.path.join(DATA_DIR, "businesses.csv"), newline="") as f:
        placed = {r["biz_key"]: r for r in csv.DictReader(f)}
    with open(os.path.join(DATA_DIR, f"ppp_{state}.csv"), newline="") as f:
        loans = list(csv.DictReader(f))
    for q in queries:
        hits = [r for r in loans if q in (r.get("BorrowerName") or "").upper()]
        print(f"LOOKUP {q!r}: {len(hits)} PPP loan(s)", flush=True)
        for r in hits:
            name = r["BorrowerName"].strip()
            biz = placed.get(f"{norm_name(name)}|{(r.get('BorrowerZip') or '').strip()[:5]}")
            if biz is None:
                reason = "merged into a duplicate listing at the same address, or no loan amount"
            elif biz["is_individual"] == "True":
                reason = f"EXCLUDED: {biz['business_type']} (sole proprietors/self-employed aren't listed)"
            elif biz.get("geo_precision") not in LISTED:
                reason = f"EXCLUDED: address couldn't be placed (geo={biz.get('geo_precision') or 'none'})"
            else:
                reason = f"LISTED ({biz['geo_precision']})"
            print(f"  - {name} | {r.get('BorrowerAddress')}, {r.get('BorrowerCity')} {r.get('BorrowerZip')} | "
                  f"type={r.get('BusinessType')} | jobs={r.get('JobsReported')} | "
                  f"loan=${r.get('CurrentApprovalAmount')} | {reason}", flush=True)


if __name__ == "__main__":
    main()
