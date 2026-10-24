"""OSHA inspections: workplace inspections, employees at the site, violations and penalties.

    DATABASE_URL=... python etl/osha.py --state OK

From the Department of Labor's enforcement data catalog (enforcedata.dol.gov): inspections of
establishments in the state since INSPECTED_SINCE, with the number of employees the inspector
recorded and the penalties from the violations file.
"""
import argparse
import csv
import io
import re
import sys
import tempfile
import zipfile
from collections import defaultdict

import psycopg

import enrich
from load import database_url
from matching import match_entities
from netutil import urlopen

CATALOG = "https://enforcedata.dol.gov/views/data_catalogs.php"
BASE = "https://enforcedata.dol.gov"
INSPECTED_SINCE = "2015-01-01"

csv.field_size_limit(sys.maxsize)


def catalog_links(kind):
    with urlopen(CATALOG, timeout=120) as r:
        html = r.read().decode("utf-8", "replace")
    links = sorted(set(re.findall(rf'href="([^"]*osha_{kind}[^"]*\.zip)"', html, re.I)))
    print(f"osha: {kind} files {links}", flush=True)
    return [l if l.startswith("http") else BASE + "/" + l.lstrip("/") for l in links]


def rows_of(url):
    """Stream every CSV row of a (possibly multi-file) zip as dicts."""
    with tempfile.TemporaryFile() as tmp:
        with urlopen(url, timeout=1800) as r:
            while chunk := r.read(1 << 20):
                tmp.write(chunk)
        tmp.seek(0)
        with zipfile.ZipFile(tmp) as z:
            for name in z.namelist():
                if name.lower().endswith(".csv"):
                    with z.open(name) as f:
                        yield from csv.DictReader(io.TextIOWrapper(f, encoding="latin-1", newline=""))


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", default="OK")
    state = ap.parse_args().state.upper()
    inspections = {}
    for url in catalog_links("inspection"):
        for r in rows_of(url):
            if (r.get("site_state") or "").upper() != state or (r.get("open_date") or "") < INSPECTED_SINCE:
                continue
            inspections[r["activity_nr"]] = {
                "name": (r.get("estab_name") or "").strip(),
                "place": ((r.get("site_address") or "").strip(), (r.get("site_city") or "").strip().upper(),
                          (r.get("site_zip") or "")[:5]),
                "date": r.get("open_date", "")[:10], "employees": num(r.get("nr_in_estab")),
                "type": r.get("insp_type"), "penalty": 0.0, "serious": 0,
            }
    print(f"osha: {len(inspections):,} {state} inspections since {INSPECTED_SINCE}", flush=True)
    for url in catalog_links("violation"):
        for r in rows_of(url):
            insp = inspections.get(r.get("activity_nr"))
            if insp is None:
                continue
            insp["penalty"] += num(r.get("current_penalty")) or 0
            if (r.get("viol_type") or "") in ("S", "W", "R"):   # serious, willful, repeat
                insp["serious"] += 1
    by_estab = defaultdict(lambda: {"names": set(), "places": set(), "inspections": []})
    for nr, i in inspections.items():
        e = by_estab[(i["name"].upper(), i["place"][2])]
        e["names"].add(i["name"])
        e["places"].add(i["place"])
        e["inspections"].append({k: i[k] for k in ("date", "employees", "type", "penalty", "serious")} | {"id": nr})
    entities = dict(enumerate(by_estab.values()))
    with psycopg.connect(database_url()) as conn, conn.cursor() as cur:
        biz = enrich.businesses(cur, state)
        matches = match_entities(entities, biz)
        out = defaultdict(list)
        for i, key in matches.items():
            out[key] += entities[i]["inspections"]
        rows = {}
        for key, items in out.items():
            items.sort(key=lambda x: x["date"], reverse=True)
            counts = [x["employees"] for x in items if x["employees"]]
            rows[key] = {
                "inspections": items[:25], "count": len(items),
                "penalties": round(sum(x["penalty"] for x in items)),
                "serious": sum(x["serious"] for x in items),
                "employees_latest": counts[0] if counts else None,
                "url_base": "https://www.osha.gov/ords/imis/establishment.inspection_detail?id=",
            }
        names = {b["biz_key"]: b["name"] for b in biz}
        print(f"osha: matched {len(matches):,} establishments to {len(rows):,} businesses", flush=True)
        for key, d in list(rows.items())[:10]:
            print(f"  match: {names[key]}: {d['count']} inspections, latest employees {d['employees_latest']}, "
                  f"penalties ${d['penalties']:,}", flush=True)
        enrich.save(cur, state, "osha", rows)


if __name__ == "__main__":
    main()
