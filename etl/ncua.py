"""Credit unions: reported income, assets, members and staff from NCUA call reports.

    DATABASE_URL=... python etl/ncua.py --state OK

Every federally insured credit union in the state, from NCUA's quarterly call report files (the
latest quarter published). Income figures are year-to-date in the files, so they're annualized
(June: x2). Revenue = interest income + non-interest income; "EBITDA" is shown as net income, as for
banks (credit unions pay no income tax, and interest is their main cost of business).
"""
import argparse
import csv
import io
import time
import zipfile

import psycopg

import enrich
from load import database_url
from matching import match_entities
from netutil import urlopen

URL = "https://www.ncua.gov/files/publications/analysis/call-report-data-{y}-{m:02d}.zip"


def latest_zip():
    """(year, month, ZipFile) of the newest quarter published."""
    t = time.gmtime()
    y, m = t.tm_year, (t.tm_mon - 1) // 3 * 3 or 12
    if m == 12 and t.tm_mon <= 3:
        y -= 1
    for _ in range(6):
        try:
            with urlopen(URL.format(y=y, m=m), timeout=300) as r:
                return y, m, zipfile.ZipFile(io.BytesIO(r.read()))
        except Exception as e:  # noqa: BLE001  (not published yet: try the quarter before)
            print(f"ncua: {y}-{m:02d} unavailable ({e!r})", flush=True)
        y, m = (y - 1, 12) if m == 3 else (y, m - 3)
    raise SystemExit("ncua: no call report file found")


def table(z, name, keep=None):
    rows = csv.DictReader(io.TextIOWrapper(z.open(name), "latin-1"))
    return {r["CU_NUMBER"]: r for r in rows if keep is None or r["CU_NUMBER"] in keep}


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", default="OK")
    state = ap.parse_args().state.upper()
    year, month, z = latest_zip()
    info = {k: r for k, r in table(z, "FOICU.txt").items() if r["STATE"] == state}
    fs, fsa = table(z, "FS220.txt", set(info)), table(z, "FS220A.txt", set(info))
    annual = 12 / month
    print(f"ncua: {len(info):,} {state} credit unions ({year}-{month:02d})", flush=True)
    entities = {}
    for cu, i in info.items():
        a, b = fs.get(cu, {}), fsa.get(cu, {})
        interest, other = num(b.get("ACCT_115")), num(b.get("ACCT_117"))
        revenue = ((interest or 0) + (other or 0)) * annual if interest is not None else None
        net = num(b.get("ACCT_661A"))
        full, part = num(b.get("ACCT_564A")) or 0, num(b.get("ACCT_564B")) or 0
        opened = str(i.get("YEAR_OPENED") or "")
        entities[cu] = {
            "names": {i["CU_NAME"]} if "CREDIT UNION" in i["CU_NAME"].upper()
                     else {i["CU_NAME"], f"{i['CU_NAME']} CREDIT UNION", f"{i['CU_NAME']} FEDERAL CREDIT UNION"},
            "places": {((i.get("STREET") or "").strip(), (i.get("CITY") or "").strip().upper(), str(i.get("ZIP_CODE") or "")[:5])},
            "data": {
                "charter": cu, "name": i["CU_NAME"].title(), "revenue": round(revenue) if revenue else None,
                "ebitda": round(net * annual) if net is not None else None,
                "assets": num(a.get("ACCT_010")), "members": num(a.get("ACCT_083")),
                "employees": round(full + part / 2) if full or part else None,
                "year": year, "quarter": f"{year}-{month:02d}",
                "founded": int(opened) if opened.isdigit() and 1850 < int(opened) <= year else None,
                "url": f"https://mapping.ncua.gov/ResearchCreditUnion/Details?charterNumber={cu}",
            },
        }
    with psycopg.connect(database_url()) as conn, conn.cursor() as cur:
        biz = enrich.businesses(cur, state)
        matches = match_entities(entities, biz)
        rows = {key: entities[cu]["data"] for cu, key in matches.items()}
        names = {b["biz_key"]: b["name"] for b in biz}
        for key, d in list(rows.items())[:12]:
            print(f"  match: {names[key]} <- {d['name']} revenue ${d['revenue'] or 0:,.0f} assets ${d['assets'] or 0:,.0f}", flush=True)
        print(f"ncua: unmatched: {sorted(e['data']['name'] for c, e in entities.items() if c not in matches)[:40]}", flush=True)
        enrich.save(cur, state, "ncua", rows)
        enrich.apply_reported(cur, state)


if __name__ == "__main__":
    main()
