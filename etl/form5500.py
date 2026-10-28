"""Yearly headcounts from DOL Form 5500 retirement-plan filings, matched to our businesses.

    DATABASE_URL=... python etl/form5500.py --state OK

Every employer with a retirement plan files a Form 5500 (or the short 5500-SF) each year, with the
number of active participants at year end. We keep single-employer pension plans (401(k)s etc.)
sponsored in the state, take each sponsor's largest plan per year (a 401(k) and a pension cover the
same people, so they're not added), match sponsors to listed businesses by name and address, and
store the counts in `headcounts`. Filtered rows are cached per year in data/cache/form5500/; recent
years are re-downloaded monthly because late filings keep arriving.
"""
import argparse
import csv
import io
import json
import os
import re
import sys
import tempfile
import time
import zipfile
from collections import Counter, defaultdict
from datetime import date

import psycopg

import enrich
import records_only
import headcount_estimates
from csvio import write_rows
from load import database_url
from matching import match_entities
from netutil import urlopen

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(HERE, "..", "data", "cache", "form5500")
BASE = os.environ.get("FORM5500_URL") or "https://askebsa.dol.gov/FOIA%20Files/{year}/Latest/{form}_{year}_Latest.zip"
FORMS = ["F_5500", "F_5500_SF"]
FIRST_YEAR = 2020
REFRESH_DAYS = 30
CACHE_VERSION = 4   # bump when the row filter changes: the cache only holds rows that passed it
# Staffing firms report every temp worker they've placed nationwide (hundreds of thousands); those
# aren't the business's own employees.
MAX_PARTICIPANTS = 25_000
# Plan-entity code meaning "single employer" differs by form: 2 on the 5500 (1 = multiemployer,
# 3 = multiple-employer), 1 on the 5500-SF (2 = multiple-employer).
SINGLE_EMPLOYER = {"F_5500": ("", "2"), "F_5500_SF": ("", "1")}
CACHE_COLS = ["year", "form", "ein", "plan_num", "name", "dba", "address", "city", "zip", "naics", "active",
              "ack_id", "signer"]
SCH_H = "https://askebsa.dol.gov/FOIA%20Files/{year}/Latest/F_SCH_H_{year}_Latest.zip"

csv.field_size_limit(sys.maxsize)

# Column names differ between the two forms (and occasionally between years), so each field is
# found by pattern; the chosen columns are printed so a layout change is easy to spot in the log.
FIELDS = {
    "ein": [r"^(SF_)?SPONS(_DFE)?_EIN$"],
    "plan_num": [r"^(SF_)?(SPONS_DFE_)?PN$", r"^(SF_)?PLAN_NUM"],
    "name": [r"^SPONSOR_DFE_NAME$", r"^SF_SPONSOR_NAME$", r"SPONSOR.*NAME$"],
    "dba": [r"^SPONS_DFE_DBA_NAME$", r"^SF_SPONSOR_DFE_DBA_NAME$", r"DBA_NAME$"],
    "address": [r"^(SF_)?SPONS(_DFE)?_(MAIL_)?US_ADDRESS1$"],
    "city": [r"^(SF_)?SPONS(_DFE)?_(MAIL_)?US_CITY$"],
    "state": [r"^(SF_)?SPONS(_DFE)?_(MAIL_)?US_STATE$"],
    "zip": [r"^(SF_)?SPONS(_DFE)?_(MAIL_)?US_ZIP$"],
    "loc_address": [r"^(SF_)?SPONS(_DFE)?_LOC_US_ADDRESS1$"],
    "loc_city": [r"^(SF_)?SPONS(_DFE)?_LOC_US_CITY$"],
    "loc_state": [r"^(SF_)?SPONS(_DFE)?_LOC_US_STATE$"],
    "loc_zip": [r"^(SF_)?SPONS(_DFE)?_LOC_US_ZIP$"],
    "naics": [r"^(SF_)?BUSINESS_CODE$"],
    "ack_id": [r"^ACK_ID$"],
    # Who signed the filing for the employer (often the owner, CFO or head of HR).
    "signer": [r"^SPONS_SIGNED_NAME$", r"^SF_SPONS_SIGNED_NAME$"],
    # Active participants at year end; the 5500-SF only has it on newer layouts, else total at year end.
    "active": [r"^TOT_ACTIVE_PARTCP_CNT$", r"^SF_TOT_ACT_PARTCP_EOY_CNT$", r"^SF_TOT_PARTCP_EOY_CNT$"],
    "pension": [r"^(SF_)?TYPE_PENSION_BNFT_CODE$"],
    "entity": [r"^(SF_)?TYPE_PLAN_ENTITY_CD$", r"^SF_PLAN_ENTITY_CD$"],
}
REQUIRED = ["ein", "name", "city", "state", "active", "pension"]


def find_columns(header):
    cols = {}
    for field, patterns in FIELDS.items():
        for pat in patterns:
            hit = next((h for h in header if re.search(pat, h.strip().upper())), None)
            if hit:
                cols[field] = hit
                break
    return cols


def to_int(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def download_year(year, state):
    """Filtered rows for one form year, from the DOL zips (or None if neither could be read)."""
    rows, ok = [], False
    for form in FORMS:
        url = BASE.format(year=year, form=form)
        try:
            with tempfile.TemporaryFile() as tmp:
                t = time.time()
                with urlopen(url, timeout=900) as r:
                    while chunk := r.read(1 << 20):
                        tmp.write(chunk)
                print(f"Form 5500: {form} {year}: {tmp.tell() / 1e6:,.0f} MB in {time.time() - t:,.0f}s", flush=True)
                tmp.seek(0)
                with zipfile.ZipFile(tmp) as z:
                    name = next(n for n in z.namelist() if n.lower().endswith(".csv"))
                    with z.open(name) as f:
                        rows += read_csv(io.TextIOWrapper(f, encoding="latin-1", newline=""), year, form, state)
            ok = True
        except Exception as e:  # noqa: BLE001
            print(f"Form 5500: {form} {year}: not available ({e!r})", flush=True)
    return rows if ok else None


def read_csv(f, year, form, state):
    reader = csv.reader(f)
    header = next(reader)
    cols = find_columns(header)
    missing = [c for c in REQUIRED if c not in cols]
    if missing:
        print(f"Form 5500: {form} {year}: missing {missing}; columns are {header}", flush=True)
        return []
    print(f"Form 5500: {form} {year} columns: {cols}", flush=True)
    idx = {k: header.index(v) for k, v in cols.items()}
    get = lambda r, k: r[idx[k]].strip() if k in idx and idx[k] < len(r) else ""  # noqa: E731
    out, seen, kept = [], 0, 0
    why = Counter()   # what the in-state filings look like, to catch layout or code changes
    for r in reader:
        seen += 1
        mail_here = get(r, "state").upper() == state
        loc_here = get(r, "loc_state").upper() == state
        if not (mail_here or loc_here):
            continue
        why[f"entity={get(r, 'entity') or '-'} pension={'y' if get(r, 'pension') else 'n'} "
            f"active={'y' if to_int(get(r, 'active')) else 'n'}"] += 1
        # Retirement plans only; and only single-employer ones (multiemployer union plans and
        # multiple-employer plans such as PEOs cover many unrelated businesses).
        if not get(r, "pension") or get(r, "entity") not in SINGLE_EMPLOYER[form]:
            continue
        active = to_int(get(r, "active"))
        if not active or active <= 0 or active > MAX_PARTICIPANTS:
            continue
        # Prefer the physical location when the filing gives one in the state.
        pre = "loc_" if loc_here and get(r, "loc_city") else ""
        kept += 1
        out.append({
            "year": year, "form": form, "ein": get(r, "ein"), "plan_num": get(r, "plan_num"),
            "name": get(r, "name"), "dba": get(r, "dba"), "address": get(r, pre + "address"),
            "city": get(r, pre + "city"), "zip": get(r, pre + "zip")[:5], "naics": get(r, "naics"),
            "active": active, "ack_id": get(r, "ack_id"), "signer": get(r, "signer"),
        })
    print(f"Form 5500: {form} {year}: {kept:,} {state} retirement plans of {seen:,} filings; "
          f"in-state filings by type: {dict(why.most_common(8))}", flush=True)
    return out


def load_year(year, state):
    path = os.path.join(CACHE_DIR, f"{state.lower()}_{year}_v{CACHE_VERSION}.csv")
    recent = year >= date.today().year - 2
    if os.path.exists(path) and not (recent and time.time() - os.path.getmtime(path) > REFRESH_DAYS * 86400):
        return load_year_cached(path)
    rows = download_year(year, state)
    if rows is None:
        # Keep a stale cache rather than losing a year to a download hiccup.
        if os.path.exists(path):
            return load_year_cached(path)
        return []
    os.makedirs(CACHE_DIR, exist_ok=True)
    write_rows(path, CACHE_COLS, rows)
    return rows


def load_year_cached(path):
    with open(path, newline="") as f:
        return [{**r, "year": int(r["year"]), "active": int(r["active"])} for r in csv.DictReader(f)]


def sponsors_by_year(rows):
    """{ein: {"years": {year: active}, "names": set, "addrs": [...]}}; largest plan per sponsor-year."""
    out = defaultdict(lambda: {"years": {}, "names": set(), "places": set(), "naics": None})
    for r in rows:
        if not r["ein"] or r["active"] > MAX_PARTICIPANTS:   # (older caches weren't filtered)
            continue
        s = out[r["ein"]]
        s["years"][r["year"]] = max(s["years"].get(r["year"], 0), r["active"])
        # The industry code the employer gives on its newest filing (6-digit NAICS).
        code = re.sub(r"\D", "", r.get("naics") or "")
        if len(code) == 6 and r["year"] >= s.get("naics_year", 0):
            s["naics"], s["naics_year"] = code, r["year"]
        for n in (r["name"], r["dba"]):
            if n:
                s["names"].add(n.upper())
        s["places"].add((r["address"].upper(), r["city"].upper(), r["zip"]))
        s.setdefault("filings", []).append((r["year"], r.get("ack_id") or "", (r.get("signer") or "").strip()))
    return out


def load_auditors(years, ack_ids):
    """{ack_id: audit firm} from Schedule H (plans with 100+ participants must be audited by an
    independent accountant, usually the employer's CPA firm). Cached per year."""
    out = {}
    for year in years:
        path = os.path.join(CACHE_DIR, f"auditors_{year}_v1.json")
        recent = year >= date.today().year - 2
        if os.path.exists(path) and not (recent and time.time() - os.path.getmtime(path) > REFRESH_DAYS * 86400):
            with open(path) as f:
                out.update(json.load(f))
            continue
        found = {}
        try:
            with tempfile.TemporaryFile() as tmp:
                with urlopen(SCH_H.format(year=year), timeout=900) as r:
                    while chunk := r.read(1 << 20):
                        tmp.write(chunk)
                tmp.seek(0)
                with zipfile.ZipFile(tmp) as z:
                    name = next(n for n in z.namelist() if n.lower().endswith(".csv"))
                    with z.open(name) as f:
                        reader = csv.reader(io.TextIOWrapper(f, encoding="latin-1", newline=""))
                        header = [h.strip().upper() for h in next(reader)]
                        ia, ifirm = header.index("ACK_ID"), next(i for i, h in enumerate(header) if h.endswith("ACCOUNTANT_FIRM_NAME"))
                        for row in reader:
                            if len(row) > ifirm and row[ia] in ack_ids and row[ifirm].strip():
                                found[row[ia]] = row[ifirm].strip()
        except Exception as e:  # noqa: BLE001
            print(f"Form 5500: Schedule H {year} unavailable ({e!r})", flush=True)
            continue
        os.makedirs(CACHE_DIR, exist_ok=True)
        with open(path, "w") as f:
            json.dump(found, f)
        out.update(found)
        print(f"Form 5500: Schedule H {year}: audit firms for {len(found):,} {len(ack_ids):,}-filing plans", flush=True)
    return out


def people(sponsor, auditors):
    """Newest signer and audit firm for one sponsor's filings."""
    filings = sorted(sponsor.get("filings", []), reverse=True)
    signer = next(((y, n) for y, _, n in filings if n and len(n.split()) >= 2), None)
    auditor = next(((y, auditors[a]) for y, a, _ in filings if a in auditors), None)
    out = {}
    if signer:
        out["signer"] = {"name": signer[1].title() if signer[1].isupper() else signer[1], "year": signer[0]}
    if auditor:
        out["auditor"] = {"firm": auditor[1], "year": auditor[0]}
    return out


def match(sponsors, businesses):
    """Map each sponsor EIN to one listed business, or leave it out when unsure."""
    return match_entities(sponsors, businesses)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", default="OK")
    state = ap.parse_args().state.upper()
    rows = []
    for year in range(FIRST_YEAR, date.today().year + 1):
        rows += load_year(year, state)
    if not rows:
        print("Form 5500: no filings available; leaving headcounts unchanged", flush=True)
        return
    sponsors = sponsors_by_year(rows)
    print(f"Form 5500: {len(sponsors):,} {state} sponsors with retirement plans", flush=True)

    with psycopg.connect(database_url()) as conn, conn.cursor() as cur:
        cur.execute("select biz_key, name, coalesce(address, ''), coalesce(city, ''), coalesce(zip, '') "
                    "from businesses where state = %s", (state,))
        businesses = [dict(zip(["biz_key", "name", "address", "city", "zip"], r)) for r in cur.fetchall()]
        matches = match(sponsors, businesses)
        # Several EINs can land on one business (e.g. a renamed entity): keep the largest per year.
        counts = defaultdict(dict)
        for ein, key in matches.items():
            for year, n in sponsors[ein]["years"].items():
                if n > counts[key].get(year, (0, ""))[0]:
                    counts[key][year] = (n, ein)
        print(f"Form 5500: matched {len(matches):,} of {len(sponsors):,} sponsors to "
              f"{len(counts):,} listed businesses", flush=True)
        unmatched = sorted((max(s["years"].values()), sorted(s["names"])[0], sorted(s["places"])[0][1])
                           for ein, s in sponsors.items() if ein not in matches)
        print(f"Form 5500: largest unmatched sponsors: {unmatched[::-1][:40]}", flush=True)
        names = {b["biz_key"]: b["name"] for b in businesses}
        for key in list(counts)[:15]:
            series = ", ".join(f"{y}: {n}" for y, (n, _) in sorted(counts[key].items()))
            print(f"  sample: {names[key]} -> {series} "
                  f"(sponsor {sorted(sponsors[counts[key][min(counts[key])][1]]['names'])[0]})", flush=True)
        # The full pipeline and the quick workflow can run this at the same moment: take turns.
        cur.execute("lock table headcounts in share row exclusive mode")
        cur.execute("delete from headcounts h where h.source = 'form5500' and not exists "
                    "(select 1 from businesses b where b.biz_key = h.biz_key and b.state <> %s)", (state,))
        with cur.copy("copy headcounts (biz_key, year, employees, source, ein, naics) from stdin") as cp:
            for key, years in counts.items():
                for year, (n, ein) in years.items():
                    cp.write_row((key, year, n, "form5500", ein, sponsors[ein]["naics"]))
        cur.execute("analyze headcounts")
        # People on the filings: who signed for the employer, and the plan's audit firm.
        ack_ids = {a for e in matches for _, a, _ in sponsors[e].get("filings", []) if a}
        auditors = load_auditors(range(FIRST_YEAR, date.today().year + 1), ack_ids)
        found = {}
        for ein, key in matches.items():
            p = people(sponsors[ein], auditors)
            if p and (key not in found or len(p) > len(found[key])):
                found[key] = p
        enrich.save(cur, state, "form5500_people", found)
        print(f"Form 5500: signers for {sum(1 for p in found.values() if 'signer' in p):,} businesses, "
              f"audit firms for {sum(1 for p in found.values() if 'auditor' in p):,}", flush=True)
        # Recent sponsors matching no business become listings of their own (sized from the plan).
        since = date.today().year - headcount_estimates.RECENT_YEARS
        records = []
        for ein, s in sponsors.items():
            if ein in matches and not records_only.own_listing(matches[ein]):
                continue
            year = max(s["years"])
            if year < since or s["years"][year] < headcount_estimates.MIN_PARTICIPANTS:
                continue
            street, city, zip5 = sorted(s["places"])[0]
            records.append({"id": ein, "name": sorted(s["names"])[0], "address": street, "city": city, "zip": zip5,
                            "employees": s["years"][year], "naics": s["naics"] or "", "year": year})
        records_only.save(cur, state, "form5500", records)
        headcount_estimates.apply(cur, state)
    print("Form 5500: headcounts saved", flush=True)


if __name__ == "__main__":
    main()
