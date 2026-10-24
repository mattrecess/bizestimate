"""SBA 7(a) and 504 loans since fiscal 2020: amounts, lenders, jobs supported, changes of ownership.

    DATABASE_URL=... python etl/sba_loans.py --state OK

From the SBA's public FOIA files (data.sba.gov, dataset 7a-504-foia). Each loan's "business age"
says whether it financed a change of ownership, which flags businesses that were bought.
"""
import argparse
import csv
import io
import json
import re
from collections import defaultdict

import psycopg

import enrich
from load import database_url
from matching import match_entities, name_tokens
from netutil import urlopen

CKAN = "https://data.sba.gov/api/3/action/package_show?id=7a-504-foia"
DATASET_PAGE = "https://data.sba.gov/dataset/7a-504-foia"
FIRST_FY = 2020

csv.field_size_limit(10_000_000)


def resource_urls():
    try:
        with urlopen(CKAN, timeout=60) as r:
            urls = [res["url"] for res in json.load(r)["result"]["resources"]]
    except Exception as e:  # noqa: BLE001
        print(f"sba_loans: CKAN API failed ({e}); reading the dataset page", flush=True)
        with urlopen(DATASET_PAGE, timeout=60) as r:
            urls = re.findall(r'href="(https?://[^"]+?\.csv)"', r.read().decode("utf-8", "replace"))
    # The 7(a) file covering 2020 onward, and the 504 file (one file covers all years).
    keep = [u for u in set(urls) if u.lower().endswith(".csv") and
            (("7a" in u.lower() and re.search(r"fy20(2\d)|2020", u.lower()))
             or ("504" in u.lower() and "fy1991" not in u.lower()))]
    print(f"sba_loans: files {sorted(keep)}", flush=True)
    return sorted(keep)


class _Row(dict):
    """Case-insensitive column access: row.get("BorrState")."""
    def get(self, key, default=None):
        return super().get(key.lower(), default)


def num(v):
    try:
        return float(str(v).replace(",", "").replace("$", ""))
    except ValueError:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", default="OK")
    state = ap.parse_args().state.upper()
    borrowers = defaultdict(lambda: {"names": set(), "places": set(), "loans": []})
    for url in resource_urls():
        program = "504" if "504" in url.lower() else "7(a)"
        n = 0
        with urlopen(url, timeout=900) as r:
            reader = csv.reader(io.TextIOWrapper(r, encoding="utf-8-sig", errors="replace", newline=""))
            # Column names vary in case between files ("BorrState" / "borrstate").
            header = [h.strip().lower() for h in next(reader)]
            print(f"sba_loans: {program} columns {header}", flush=True)
            for values in reader:
                row = _Row(zip(header, values))
                if (row.get("BorrState") or "").strip().upper() != state:
                    continue
                fy = num(row.get("ApprovalFY") or row.get("ApprovalFiscalYear"))
                if not fy or fy < FIRST_FY:
                    continue
                name = (row.get("BorrName") or "").strip()
                zip5 = (row.get("BorrZip") or "").strip()[:5]
                if not name:
                    continue
                key = (" ".join(sorted(name_tokens(name))), zip5)
                b = borrowers[key]
                b["names"].add(name)
                b["places"].add(((row.get("BorrStreet") or "").strip(), (row.get("BorrCity") or "").strip().upper(), zip5))
                b["loans"].append({
                    "program": program, "amount": num(row.get("GrossApproval")),
                    "date": (row.get("ApprovalDate") or "").strip(), "fiscal_year": int(fy),
                    "lender": (row.get("BankName") or row.get("ThirdPartyLender_Name") or "").strip(),
                    "cdc": (row.get("CDC_Name") or "").strip() or None,
                    "jobs": num(row.get("JobsSupported")),
                    "business_age": (row.get("BusinessAge") or "").strip(),
                    "status": (row.get("LoanStatus") or "").strip(),
                    "franchise": (row.get("FranchiseName") or "").strip() or None,
                })
                n += 1
        print(f"sba_loans: {n:,} {state} {program} loans since FY{FIRST_FY} in {url.rsplit('/', 1)[-1]}", flush=True)
    entities = {i: b for i, b in enumerate(borrowers.values())}
    with psycopg.connect(database_url()) as conn, conn.cursor() as cur:
        biz = enrich.businesses(cur, state)
        matches = match_entities(entities, biz)
        rows = defaultdict(list)
        for i, key in matches.items():
            rows[key] += entities[i]["loans"]
        out = {}
        for key, loans in rows.items():
            loans.sort(key=lambda l: l["date"], reverse=True)
            ownership = [l["fiscal_year"] for l in loans if "change of ownership" in l["business_age"].lower()]
            out[key] = {
                "loans": loans, "total": sum(l["amount"] or 0 for l in loans),
                "ownership_change_year": max(ownership) if ownership else None,
                "franchise": next((l["franchise"] for l in loans if l["franchise"]), None),
            }
        names = {b["biz_key"]: b["name"] for b in biz}
        print(f"sba_loans: {len(borrowers):,} borrowers; matched {len(matches):,} to {len(out):,} businesses; "
              f"{sum(1 for d in out.values() if d['ownership_change_year']):,} with a change of ownership", flush=True)
        for key, d in list(out.items())[:10]:
            l = d["loans"][0]
            print(f"  sample: {names[key]}: {len(d['loans'])} loan(s), latest {l['program']} ${l['amount'] or 0:,.0f} "
                  f"{l['date']} via {l['lender']} ({l['business_age']})", flush=True)
        enrich.save(cur, state, "sba", out)


if __name__ == "__main__":
    main()
