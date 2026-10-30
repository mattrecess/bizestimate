"""Public companies: reported revenue and earnings from SEC filings (XBRL company facts).

    DATABASE_URL=... python etl/sec.py --state OK

Companies whose business address is in the state are listed from EDGAR; for each, the latest annual
(10-K) figures come from the SEC's company-facts API. EBITDA = operating income + depreciation,
depletion and amortization where both are reported. Revenue is the whole company's, worldwide.
"""
import argparse
import json
import os
import re
import time

import psycopg

import enrich
from load import database_url
from matching import full_name, match_entities
from netutil import urlopen

# The SEC requires a contact email it accepts (it refuses no-reply addresses), set as the
# SEC_USER_AGENT secret, e.g. "BizEstimate you@example.com".
UA = os.environ.get("SEC_USER_AGENT", "").strip()
LIST = ("https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&State={state}&type=10-K"
        "&dateb=&owner=include&count=100&start={start}")
FACTS = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json"
SUBMISSIONS = "https://data.sec.gov/submissions/CIK{cik:010d}.json"
REVENUE = ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet",
           "RevenueFromContractWithCustomerIncludingAssessedTax", "RevenuesNetOfInterestExpense"]
DNA = ["DepreciationDepletionAndAmortization", "DepreciationAndAmortization",
       "DepreciationAmortizationAndAccretionNet", "Depreciation"]
MAX_AGE_YEARS = 3


def get(url):
    time.sleep(0.12)   # SEC fair-access limit is 10 requests per second
    with urlopen(url, headers={"User-Agent": UA, "Accept-Encoding": "identity"}, timeout=120) as r:
        return r.read().decode("utf-8", "replace")


def annual(facts, names):
    """Latest full-year 10-K value among several possible XBRL tags: (value, fiscal year)."""
    best = None
    for name in names:
        units = facts.get("us-gaap", {}).get(name, {}).get("units", {}).get("USD", [])
        for u in units:
            if u.get("form") not in ("10-K", "10-K/A") or u.get("fp") != "FY" or not u.get("end"):
                continue
            # A full year (about 365 days), not a quarter reported inside the 10-K.
            if u.get("start") and abs((time.mktime(time.strptime(u["end"], "%Y-%m-%d"))
                                       - time.mktime(time.strptime(u["start"], "%Y-%m-%d"))) / 86400 - 365) > 20:
                continue
            key = (u["end"], u.get("filed", ""))
            if best is None or key > best[0]:
                best = (key, u["val"], int(u["end"][:4]))
    return (best[1], best[2]) if best else (None, None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", default="OK")
    state = ap.parse_args().state.upper()
    if not UA:
        print("sec: skipped; add a SEC_USER_AGENT secret (\"BizEstimate you@example.com\") to enable", flush=True)
        return
    ciks = {}
    for start in range(0, 20_000, 100):   # every page: EDGAR lists filers alphabetically
        html = get(LIST.format(state=state, start=start))
        found = re.findall(r'CIK=(\d+)[^>]*>\d+</a></td>\s*<td[^>]*>([^<]+)', html)
        for cik, name in found:
            ciks[int(cik)] = re.sub(r"\s+", " ", name).strip()
        if len(found) < 100:
            break
    print(f"sec: {len(ciks):,} {state} filers listed", flush=True)
    entities, this_year = {}, time.gmtime().tm_year
    for cik, name in ciks.items():
        try:
            facts = json.loads(get(FACTS.format(cik=cik))).get("facts", {})
        except Exception:  # noqa: BLE001  (no XBRL facts: shells, funds, old filers)
            continue
        revenue, year = annual(facts, REVENUE)
        if not revenue or year < this_year - MAX_AGE_YEARS:
            continue
        op, _ = annual(facts, ["OperatingIncomeLoss"])
        dna, _ = annual(facts, DNA)
        net, _ = annual(facts, ["NetIncomeLoss", "ProfitLoss"])
        assets, _ = annual(facts, ["Assets"])
        try:
            sub = json.loads(get(SUBMISSIONS.format(cik=cik)))
            addr = sub.get("addresses", {}).get("business", {})
            names = {sub.get("name") or name} | {f.get("name") for f in sub.get("formerNames", []) if f.get("name")}
            tickers = sub.get("tickers", [])
        except Exception:  # noqa: BLE001
            addr, names, tickers = {}, {name}, []
        clean = {re.sub(r"/[A-Z]{2,3}/?$", "", n).strip() for n in names}   # "DEVON ENERGY CORP/DE"
        entities[cik] = {
            "names": clean,
            "places": {((addr.get("street1") or "").strip(), (addr.get("city") or "").strip().upper(),
                        (addr.get("zipCode") or "")[:5])},
            "data": {
                "cik": cik, "name": sorted(clean)[0], "tickers": tickers, "year": year, "revenue": revenue,
                "ebitda": op + dna if op is not None and dna is not None else None,
                "operating_income": op, "net_income": net, "assets": assets,
                "url": f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}&type=10-K",
            },
        }
    print(f"sec: {len(entities):,} with recent annual revenue", flush=True)
    with psycopg.connect(database_url()) as conn, conn.cursor() as cur:
        biz = enrich.businesses(cur, state)
        matches = match_entities(entities, biz)
        # A public company's name is unique enough on its own: when the address doesn't match (headquarters
        # vs the listed site), an exact name match to one listed business in the state will do.
        cur.execute("select biz_key from businesses where state = %s and est_method = 'branch'", (state,))
        branches = {k for (k,) in cur.fetchall()}
        by_name = {}
        for b in biz:
            if b["biz_key"] in branches:   # a company's other locations: match the company itself
                continue
            by_name.setdefault(full_name(b["name"]), []).append(b)
        for cik, e in entities.items():
            if cik in matches:
                continue
            found = {b["biz_key"]: b for n in e["names"] for b in by_name.get(full_name(n), [])}
            if len(found) > 1:
                # Several listings with the name (offices, yards): the one in the headquarters city, if just one.
                hq = {city for _, city, _ in e["places"]}
                found = {k: b for k, b in found.items() if b["city"].upper() in hq and not k.startswith("OV|")} or \
                        {k: b for k, b in found.items() if b["city"].upper() in hq}
            if len(found) == 1:
                matches[cik] = next(iter(found))
        rows = {}
        for cik, key in matches.items():
            if key not in rows or entities[cik]["data"]["revenue"] > rows[key]["revenue"]:
                rows[key] = entities[cik]["data"]
        names = {b["biz_key"]: b["name"] for b in biz}
        for key, d in list(rows.items())[:20]:
            print(f"  match: {names[key]} <- {d['name']} {d['tickers']} FY{d['year']} revenue ${d['revenue']:,.0f}", flush=True)
        unmatched = sorted((e["data"]["revenue"], e["data"]["name"]) for c, e in entities.items() if c not in matches)[::-1]
        print(f"sec: unmatched (largest first): {unmatched[:25]}", flush=True)
        enrich.save(cur, state, "sec", rows)
        enrich.apply_reported(cur, state)


if __name__ == "__main__":
    main()
