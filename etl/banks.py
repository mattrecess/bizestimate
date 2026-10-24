"""Banks: reported income, assets and deposits from FDIC call reports.

    DATABASE_URL=... python etl/banks.py --state OK

Every FDIC-insured bank headquartered in the state, with its latest year-end figures from the
FDIC's public API. Revenue = interest income + noninterest income; "EBITDA" for a bank is shown as
pre-tax income (interest is its main cost of doing business, so EBITDA isn't meaningful).
"""
import argparse
import json
import time
import urllib.parse

import psycopg

import enrich
from load import database_url
from matching import match_entities
from netutil import urlopen

API = "https://banks.data.fdic.gov/api/{path}?{query}"


def fdic(path, filters, fields):
    q = urllib.parse.urlencode({"filters": filters, "fields": ",".join(fields), "limit": 10000, "format": "json"})
    with urlopen(API.format(path=path, query=q), timeout=120) as r:
        return [row["data"] for row in json.loads(r.read())["data"]]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", default="OK")
    state = ap.parse_args().state.upper()
    insts = fdic("institutions", f'STALP:{state} AND ACTIVE:1',
                 ["CERT", "NAME", "ADDRESS", "CITY", "ZIP", "ESTYMD", "WEBADDR", "NAMEHCR", "OFFICES"])
    fin = []
    for year in (time.gmtime().tm_year - 1, time.gmtime().tm_year - 2):
        fin = fdic("financials", f'STALP:{state} AND REPDTE:{year}1231',
                   ["CERT", "REPDTE", "ASSET", "DEP", "NETINC", "ITAX", "INTINC", "NONII", "NUMEMP"])
        if fin:
            break
    by_cert = {str(f["CERT"]): f for f in fin}
    print(f"banks: {len(insts):,} {state} banks; year-end figures for {len(by_cert):,} ({fin[0]['REPDTE'] if fin else 'none'})", flush=True)
    entities = {}
    for i in insts:
        cert = str(i["CERT"])
        f = by_cert.get(cert, {})
        k = lambda v: None if v is None else float(v) * 1000   # noqa: E731  (FDIC reports $ thousands)
        revenue = (k(f.get("INTINC")) or 0) + (k(f.get("NONII")) or 0)
        pretax = (k(f.get("NETINC")) or 0) + (k(f.get("ITAX")) or 0) if f.get("NETINC") is not None else None
        est = str(i.get("ESTYMD") or "")
        entities[cert] = {
            "names": {i["NAME"]},
            "places": {((i.get("ADDRESS") or "").strip(), (i.get("CITY") or "").strip().upper(), str(i.get("ZIP") or "")[:5])},
            "data": {
                "cert": cert, "name": i["NAME"], "holding_company": i.get("NAMEHCR"), "offices": i.get("OFFICES"),
                "revenue": revenue or None, "ebitda": pretax, "net_income": k(f.get("NETINC")),
                "assets": k(f.get("ASSET")), "deposits": k(f.get("DEP")), "employees": f.get("NUMEMP"),
                "year": int(str(f["REPDTE"])[:4]) if f.get("REPDTE") else None,
                "founded": int(est[-4:]) if est[-4:].isdigit() else (int(est[:4]) if est[:4].isdigit() else None),
                "url": f"https://banks.data.fdic.gov/bankfind-suite/bankfind/details/{cert}",
            },
        }
    with psycopg.connect(database_url()) as conn, conn.cursor() as cur:
        biz = enrich.businesses(cur, state)
        matches = match_entities(entities, biz)
        rows = {key: entities[cert]["data"] for cert, key in matches.items()}
        names = {b["biz_key"]: b["name"] for b in biz}
        for key, d in list(rows.items())[:12]:
            print(f"  match: {names[key]} <- {d['name']} revenue ${d['revenue'] or 0:,.0f} assets ${d['assets'] or 0:,.0f}", flush=True)
        print(f"banks: unmatched: {sorted(e['data']['name'] for c, e in entities.items() if c not in matches)[:40]}", flush=True)
        enrich.save(cur, state, "fdic", rows)
        enrich.apply_reported(cur, state)


if __name__ == "__main__":
    main()
