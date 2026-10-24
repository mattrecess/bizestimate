"""Federal contracts: dollars awarded per fiscal year, from USAspending.gov.

    DATABASE_URL=... python etl/contracts.py --state OK

Contract obligations to recipients located in the state, by fiscal year, with each recipient's
address and business types (small, veteran-owned, woman-owned, ...) from its recipient profile.
"""
import argparse
import json
import time
from collections import defaultdict

import psycopg

import enrich
from load import database_url
from matching import match_entities
from netutil import urlopen

API = "https://api.usaspending.gov/api/v2/"
YEARS = 5
MIN_TOTAL = 25_000          # profiles are looked up only for recipients above this
CONTRACTS = ["A", "B", "C", "D"]


def post(path, body):
    req = json.dumps(body).encode()
    with urlopen(API + path, data=req, headers={"Content-Type": "application/json"}, timeout=120) as r:
        return json.loads(r.read())


def get(path):
    time.sleep(0.1)
    with urlopen(API + path, timeout=60) as r:
        return json.loads(r.read())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", default="OK")
    state = ap.parse_args().state.upper()
    this_fy = time.gmtime().tm_year + (1 if time.gmtime().tm_mon >= 10 else 0)
    by_recipient = defaultdict(lambda: {"name": "", "years": {}})
    for fy in range(this_fy - YEARS, this_fy + 1):
        page = 1
        while True:
            body = {"filters": {"recipient_locations": [{"country": "USA", "state": state}],
                                "award_type_codes": CONTRACTS,
                                "time_period": [{"start_date": f"{fy - 1}-10-01", "end_date": f"{fy}-09-30"}]},
                    "limit": 100, "page": page}
            res = post("search/spending_by_category/recipient/", body)
            for r in res.get("results", []):
                rid = r.get("recipient_id") or r.get("id")
                if not rid or not r.get("amount"):
                    continue
                rec = by_recipient[rid]
                rec["name"] = r.get("name") or rec["name"]
                rec["uei"] = r.get("uei") or rec.get("uei")
                rec["years"][fy] = round(r["amount"])
            if not res.get("page_metadata", {}).get("hasNext"):
                break
            page += 1
        print(f"contracts: FY{fy}: {sum(1 for r in by_recipient.values() if fy in r['years']):,} recipients", flush=True)
    entities = {}
    for rid, rec in by_recipient.items():
        total = sum(v for v in rec["years"].values() if v > 0)
        if total < MIN_TOTAL:
            continue
        try:
            prof = get(f"recipient/{rid}/")
        except Exception:  # noqa: BLE001
            continue
        loc = prof.get("location") or {}
        entities[rid] = {
            "names": {n for n in (rec["name"], prof.get("name"), *(prof.get("alternate_names") or [])) if n},
            "places": {((loc.get("address_line1") or "").strip(), (loc.get("city_name") or "").strip().upper(),
                        (loc.get("zip5") or loc.get("zip") or "")[:5])},
            "data": {
                "name": prof.get("name") or rec["name"], "uei": rec.get("uei"),
                "by_year": {str(k): v for k, v in sorted(rec["years"].items())}, "total": total,
                "business_types": prof.get("business_types") or [],
                "url": f"https://www.usaspending.gov/recipient/{rid}/latest",
            },
        }
    print(f"contracts: {len(entities):,} recipients with ${MIN_TOTAL:,}+ over {YEARS + 1} fiscal years", flush=True)
    with psycopg.connect(database_url()) as conn, conn.cursor() as cur:
        biz = enrich.businesses(cur, state)
        matches = match_entities(entities, biz)
        rows = {}
        for rid, key in matches.items():
            if key not in rows or entities[rid]["data"]["total"] > rows[key]["total"]:
                rows[key] = entities[rid]["data"]
        names = {b["biz_key"]: b["name"] for b in biz}
        for key, d in sorted(rows.items(), key=lambda kv: -kv[1]["total"])[:12]:
            print(f"  match: {names[key]} <- {d['name']} ${d['total']:,.0f} {d['business_types'][:4]}", flush=True)
        enrich.save(cur, state, "contracts", rows)


if __name__ == "__main__":
    main()
