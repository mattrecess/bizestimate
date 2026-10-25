"""Bring 2019-2020 based estimates up to date: inflation, and Oklahoma job growth by industry.

    python etl/adjust.py --fetch     # download CPI and QCEW figures into data/cache/adjust.json
    python etl/adjust.py             # print the factors in use

PPP headcounts are from 2020 and revenue benchmarks are in their own year's dollars. Two factors:
  - inflation(year): consumer prices now / in that year (BLS CPI-U, US city average).
  - growth(naics):   Oklahoma private-sector employment in the industry now / in 2020 (BLS QCEW,
                     statewide annual averages), applied to 2020 headcounts. It's the industry's
                     average growth, not the business's own.
Without the cache, built-in CPI figures are used and growth is 1 (no change).
"""
import argparse
import csv
import io
import json
import os
import time

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "..", "data", "cache", "adjust.json")
REFRESH_DAYS = 30
BASE_YEAR = 2020                         # PPP headcounts
QCEW = "https://data.bls.gov/cew/data/api/{year}/a/area/40000.csv"   # Oklahoma statewide
CPI = "https://api.bls.gov/publicAPI/v2/timeseries/data/"
GROWTH_BOUNDS = (0.7, 1.6)
MIN_BASE_EMPLOYMENT = 500                # smaller industries are too noisy to use
# CPI-U annual averages (1982-84 = 100), used until the live series is fetched.
CPI_FALLBACK = {2017: 245.1, 2018: 251.1, 2019: 255.7, 2020: 258.8, 2021: 271.0, 2022: 292.7,
                2023: 304.7, 2024: 313.7, 2025: 322.0}


def fetch():
    from netutil import urlopen
    out = {"fetched": int(time.time()), "cpi": dict(CPI_FALLBACK), "growth": {}, "growth_years": None}
    # CPI: monthly values averaged per year; the current year's partial average counts as "now".
    this_year = time.gmtime().tm_year
    try:
        body = json.dumps({"seriesid": ["CUUR0000SA0"], "startyear": str(this_year - 9), "endyear": str(this_year)}).encode()
        with urlopen(CPI, data=body, headers={"Content-Type": "application/json"}, timeout=60) as r:
            series = json.loads(r.read())["Results"]["series"][0]["data"]
        by_year = {}
        for d in series:
            if d["period"].startswith("M") and d["period"] != "M13":
                by_year.setdefault(int(d["year"]), []).append(float(d["value"]))
        for y, vals in by_year.items():
            out["cpi"][y] = round(sum(vals) / len(vals), 1)
        out["cpi_latest_months"] = len(by_year.get(max(by_year), []))
        print(f"adjust: CPI {sorted(out['cpi'].items())[-4:]}", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"adjust: CPI unavailable, using built-in figures ({e!r})", flush=True)
    # QCEW: private ownership (own_code 5), every industry level, 2020 vs the newest annual file.
    def employment(year):
        with urlopen(QCEW.format(year=year), timeout=300) as r:
            rows = csv.DictReader(io.TextIOWrapper(r, encoding="utf-8", newline=""))
            return {row["industry_code"]: float(row["annual_avg_emplvl"] or 0) for row in rows
                    if row.get("own_code") == "5" and row.get("industry_code", "").isdigit()}
    try:
        base = employment(BASE_YEAR)
        for latest in range(this_year - 1, BASE_YEAR, -1):
            try:
                now = employment(latest)
                break
            except Exception:  # noqa: BLE001  (not published yet)
                continue
        else:
            raise RuntimeError("no recent QCEW year")
        for code, b in base.items():
            if b >= MIN_BASE_EMPLOYMENT and now.get(code):
                out["growth"][code] = round(now[code] / b, 3)
        out["growth_years"] = [BASE_YEAR, latest]
        print(f"adjust: Oklahoma employment growth {BASE_YEAR}-{latest} for {len(out['growth']):,} industries "
              f"(all private: {out['growth'].get('10', 'n/a')})", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"adjust: QCEW unavailable; no growth adjustment ({e!r})", flush=True)
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    with open(CACHE + ".tmp", "w") as f:
        json.dump(out, f)
    os.replace(CACHE + ".tmp", CACHE)


class Adjust:
    def __init__(self):
        self.data = {"cpi": dict(CPI_FALLBACK), "growth": {}}
        if os.path.exists(CACHE):
            with open(CACHE) as f:
                d = json.load(f)
            d["cpi"] = {int(k): v for k, v in d["cpi"].items()}
            self.data = d
        self.now = self.data["cpi"][max(self.data["cpi"])]

    def inflation(self, year):
        """Prices now relative to `year` (1.0 for unknown years)."""
        then = self.data["cpi"].get(int(year)) if year else None
        return round(self.now / then, 3) if then else 1.0

    def growth(self, naics):
        """Oklahoma employment in the industry now vs 2020 (most specific level published)."""
        code = str(naics or "")
        for n in range(min(len(code), 6), 1, -1):
            g = self.data["growth"].get(code[:n])
            if g:
                lo, hi = GROWTH_BOUNDS
                return min(hi, max(lo, g))
        return 1.0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--fetch", action="store_true")
    if ap.parse_args().fetch:
        if os.path.exists(CACHE) and time.time() - os.path.getmtime(CACHE) < REFRESH_DAYS * 86400:
            print("adjust: cache is recent; skipping download", flush=True)
        else:
            fetch()
    a = Adjust()
    print(f"  inflation 2019 -> now: {a.inflation(2019)}, 2022 -> now: {a.inflation(2022)}")
    for code in ("561730", "562991", "423320", "423430", "238220", "722511"):
        print(f"  growth {code}: {a.growth(code)}")
