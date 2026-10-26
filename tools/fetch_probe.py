"""Probe sources: NCUA call report zips, Oklahoma open data (state vendor payments / contracts)."""
import io
import json
import re
import urllib.request
import zipfile

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/126 Safari/537.36"}


def get(url, n=50_000_000):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        return r.status, r.read(n)


for q in ("vendor payments", "contracts", "purchase card", "expenditures", "license", "contractor"):
    try:
        _, b = get(f"https://data.ok.gov/api/3/action/package_search?q={q.replace(' ', '%20')}&rows=15")
        res = json.loads(b)["result"]
        print(f"== data.ok.gov '{q}': {res['count']} datasets")
        for p in res["results"]:
            fmts = sorted({r.get('format') for r in p.get('resources', [])})
            print(f"   {p['name']} | {p['title'][:70]} | {p.get('metadata_modified', '')[:10]} | {fmts}")
    except Exception as e:  # noqa: BLE001
        print(f"== data.ok.gov {q}: {e!r}")

for ym in ("2026-06", "2026-03", "2025-12", "2025-09"):
    url = f"https://www.ncua.gov/files/publications/analysis/call-report-data-{ym}.zip"
    try:
        status, b = get(url)
        z = zipfile.ZipFile(io.BytesIO(b))
        print(f"== NCUA {ym}: {status}, {len(b):,} bytes, files {[n for n in z.namelist()][:30]}")
        for name in z.namelist():
            if name.upper() in ("FOICU.TXT", "FS220.TXT", "FS220A.TXT"):
                head = z.open(name).read(3000).decode("latin-1").splitlines()
                print(f"   {name}: {head[0][:1500]}")
                print(f"   row: {head[1][:400]}")
        break
    except Exception as e:  # noqa: BLE001
        print(f"== NCUA {ym}: {e!r}")
