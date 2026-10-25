"""Trucking and bus companies: trucks, drivers and annual miles from the FMCSA motor carrier census.

    DATABASE_URL=... python etl/fmcsa.py --state OK

Every carrier with a USDOT number and a physical address in the state (data.transportation.gov,
Company Census File). Power units and drivers are a direct measure of a carrier's size.
"""
import argparse
import json
import re
import urllib.parse

import psycopg

import enrich
from load import database_url
from matching import match_entities
from netutil import urlopen

URL = "https://data.transportation.gov/resource/az4n-8mr2.json?"
PAGE = 50_000
MIN_POWER_UNITS = 2     # one-truck owner-operators are mostly individuals, not listed businesses


def format_phone(number):
    digits = re.sub(r"\D", "", str(number or ""))
    digits = digits[1:] if len(digits) == 11 and digits[0] == "1" else digits
    return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}" if len(digits) == 10 and digits[0] not in "01" else None


def clean_email(value):
    e = str(value or "").strip().lower()
    return e if re.fullmatch(r"[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}", e) else None


def pick(row, *names):
    for n in names:
        if row.get(n) not in (None, ""):
            return row[n]
    return None


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", default="OK")
    state = ap.parse_args().state.upper()
    rows, offset = [], 0
    while True:
        q = urllib.parse.urlencode({"$where": f"phy_state='{state}'", "$limit": PAGE, "$offset": offset, "$order": ":id"})
        with urlopen(URL + q, timeout=300) as r:
            batch = json.loads(r.read())
        rows += batch
        if len(batch) < PAGE:
            break
        offset += PAGE
    if rows:
        print(f"fmcsa: {len(rows):,} {state} carriers; fields {sorted(rows[0])}", flush=True)
    entities = {}
    for r in rows:
        units = num(pick(r, "nbr_power_unit", "power_units", "tot_pwr"))
        if not units or units < MIN_POWER_UNITS:
            continue
        status = (pick(r, "status_code", "carrier_status") or "A").upper()
        if status not in ("A", "ACTIVE"):
            continue
        drivers = num(pick(r, "driver_total", "total_drivers", "tot_drs"))
        # Self-reported; some entries are typos ("115000 trucks, 2 drivers"). Drop fleets that are
        # implausibly large for the driver count rather than show them.
        if units > 100 and units > 5 * max(drivers or 0, 1):
            continue
        dot = str(pick(r, "dot_number", "usdot_number"))
        added = str(pick(r, "add_date", "added_date") or "")
        names = {n.strip() for n in (pick(r, "legal_name"), pick(r, "dba_name")) if n and n.strip()}
        entities[dot] = {
            "names": names,
            "places": {((pick(r, "phy_street") or "").strip(), (pick(r, "phy_city") or "").strip().upper(),
                        str(pick(r, "phy_zip") or "")[:5])},
            "data": {
                "dot": dot, "name": pick(r, "legal_name"), "power_units": units,
                "drivers": drivers,
                "miles": num(pick(r, "mcs150_mileage", "mileage")),
                "miles_year": pick(r, "mcs150_mileage_year", "mileage_year"),
                "operation": pick(r, "carrier_operation", "carrier_operation_desc"),
                "hazmat": (pick(r, "hm_flag", "hm_ind") or "").upper() == "Y",
                "registered": int(added[:4]) if added[:4].isdigit() else None,
                "phone": format_phone(pick(r, "phone", "telephone")),
                "email": clean_email(pick(r, "email_address", "email")),
                "url": f"https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=USDOT&query_string={dot}",
            },
        }
    print(f"fmcsa: {len(entities):,} active carriers with {MIN_POWER_UNITS}+ power units", flush=True)
    with psycopg.connect(database_url()) as conn, conn.cursor() as cur:
        biz = enrich.businesses(cur, state)
        matches = match_entities(entities, biz)
        out = {}
        for dot, key in matches.items():
            if key not in out or entities[dot]["data"]["power_units"] > out[key]["power_units"]:
                out[key] = entities[dot]["data"]
        names = {b["biz_key"]: b["name"] for b in biz}
        for key, d in sorted(out.items(), key=lambda kv: -kv[1]["power_units"])[:12]:
            print(f"  match: {names[key]} <- {d['name']} {d['power_units']:.0f} trucks, {d['drivers'] or 0:.0f} drivers", flush=True)
        enrich.save(cur, state, "fmcsa", out)


if __name__ == "__main__":
    main()
