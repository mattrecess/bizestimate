"""Payments from Oklahoma state agencies to each business (OMES vendor payments, data.ok.gov).

    DATABASE_URL=... python etl/state_payments.py --state OK

Reads the monthly vendor payment tables for the last two state fiscal years through the open-data
portal's API (only the vendor, place, amount and agency columns), totals them per vendor and
matches vendors to listed businesses by name and ZIP. The state fiscal year runs July-June:
FY2026 = July 2025 to June 2026. Only runs for Oklahoma.
"""
import argparse
import json
import time
import urllib.parse
from collections import Counter, defaultdict

import psycopg

import enrich
from load import database_url
from matching import match_entities
from netutil import urlopen

API = "https://data.ok.gov/api/3/action/"
PACKAGE = "state-of-oklahoma-vendor-payments-fiscal-year-{fy}"
FIELDS = ["VENDOR_NAME", "CITY", "STATE", "POSTAL", "PYMNT_AMT", "AGENCYNAME", "CALENDAR_YEAR", "CALENDAR_MONTH"]
PAGE = 32_000
MIN_TOTAL = 10_000          # smaller vendors are mostly one-off purchases and reimbursements


def call(action, **params):
    url = API + action + "?" + urllib.parse.urlencode(params)
    for attempt in range(4):
        try:
            with urlopen(url, timeout=300) as r:
                return json.loads(r.read())["result"]
        except Exception:  # noqa: BLE001
            if attempt == 3:
                raise
            time.sleep(15 * (attempt + 1))


def fiscal_year(year, month):
    return year + 1 if month >= 7 else year


def month_totals(resource_id):
    """{vendor key: [name, city, zip5, amount, {agency: amount}]} for one monthly table."""
    out, offset = {}, 0
    while True:
        res = call("datastore_search", resource_id=resource_id, limit=PAGE, offset=offset, fields=",".join(FIELDS))
        for r in res["records"]:
            if (r.get("STATE") or "").strip().upper() != "OK":
                continue
            try:
                amount = float(r.get("PYMNT_AMT") or 0)
            except ValueError:
                continue
            name = (r.get("VENDOR_NAME") or "").strip()
            zip5 = (r.get("POSTAL") or "").strip()[:5]
            key = f"{name.upper()}|{zip5}"
            v = out.setdefault(key, [name, (r.get("CITY") or "").strip().upper(), zip5, 0.0, {},
                                     fiscal_year(int(r.get("CALENDAR_YEAR") or 0), int(r.get("CALENDAR_MONTH") or 0))])
            v[3] += amount
            agency = (r.get("AGENCYNAME") or "").strip().title()
            v[4][agency] = v[4].get(agency, 0) + amount
        offset += PAGE
        if offset >= res.get("total", 0) or not res["records"]:
            return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", default="OK")
    state = ap.parse_args().state.upper()
    if state != "OK":
        print("state_payments: Oklahoma only", flush=True)
        return
    t = time.gmtime()
    current = fiscal_year(t.tm_year, t.tm_mon)
    months = {}
    for fy in (current - 1, current):
        try:
            pkg = call("package_show", id=PACKAGE.format(fy=fy))
        except Exception as e:  # noqa: BLE001
            print(f"state_payments: FY{fy} not published ({e!r})", flush=True)
            continue
        for res in pkg["resources"]:
            if res.get("datastore_active"):
                months[res["id"]] = {"fy": fy, "totals": month_totals(res["id"])}
                print(f"state_payments: FY{fy} {res.get('name')}: {len(months[res['id']]['totals']):,} Oklahoma vendors", flush=True)
    if not months:
        raise SystemExit("state_payments: no payment tables readable")
    with psycopg.connect(database_url()) as conn, conn.cursor() as cur:
        keep = {m["fy"] for m in months.values()}
        keep = set(sorted(keep)[-2:])
        vendors = defaultdict(lambda: {"names": set(), "places": set(), "by_year": Counter(), "agencies": Counter()})
        for m in months.values():
            if m["fy"] not in keep:
                continue
            for key, (name, city, zip5, amount, agencies, fy) in m["totals"].items():
                v = vendors[key]
                v["names"].add(name)
                v["places"].add(("", city, zip5))
                v["by_year"][str(fy)] += amount
                v["agencies"].update(agencies)
        entities = {}
        for key, v in vendors.items():
            total = sum(v["by_year"].values())
            if total < MIN_TOTAL:
                continue
            entities[key] = {"names": v["names"], "places": v["places"], "data": {
                "total": round(total), "by_year": {y: round(a) for y, a in sorted(v["by_year"].items())},
                "agencies": [a for a, _ in v["agencies"].most_common(3)], "vendor": sorted(v["names"])[0],
                "url": "https://data.ok.gov/dataset/" + PACKAGE.format(fy=max(keep)),
            }}
        print(f"state_payments: {len(entities):,} vendors paid ${MIN_TOTAL:,}+ in FY{min(keep)}-FY{max(keep)}", flush=True)
        biz = enrich.businesses(cur, state)
        matches = match_entities(entities, biz)
        rows = {}
        for key, biz_key in matches.items():   # a business with several vendor records: add them up
            d = entities[key]["data"]
            if biz_key in rows:
                r = rows[biz_key]
                r["total"] += d["total"]
                for y, a in d["by_year"].items():
                    r["by_year"][y] = r["by_year"].get(y, 0) + a
            else:
                rows[biz_key] = {**d, "by_year": dict(d["by_year"])}
        names = {b["biz_key"]: b["name"] for b in biz}
        for key, d in sorted(rows.items(), key=lambda kv: -kv[1]["total"])[:12]:
            print(f"  match: {names[key]} <- {d['vendor']} ${d['total']:,.0f} ({', '.join(d['agencies'])})", flush=True)
        enrich.save(cur, state, "state_payments", rows)


if __name__ == "__main__":
    main()
