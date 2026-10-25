"""Bring 2019-2020 based estimates up to date: inflation, and Oklahoma job growth by industry.

    python etl/adjust.py --fetch     # refresh the figures into data/cache/adjust.json
    python etl/adjust.py             # print the factors in use

PPP headcounts are from 2020 and revenue benchmarks are in their own year's dollars. Two factors:
  - inflation(year): consumer prices now / in that year (CPI-U, US city average). Built-in annual
                     averages, refreshed from FRED when it answers (BLS itself refuses cloud servers).
  - growth(naics):   Oklahoma employment in the industry now / in 2020, from the Census County
                     Business Patterns (needs CENSUS_API_KEY), applied to 2020 headcounts. It's the
                     industry's average growth, not the business's own.
Without those, inflation uses the built-in figures and growth is 1 (no change).
"""
import argparse
import json
import os
import time

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "..", "data", "cache", "adjust.json")
REFRESH_DAYS = 30
BASE_YEAR = 2020                         # PPP headcounts
FRED_CPI = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCSL"
CBP = "https://api.census.gov/data/{year}/cbp?get=EMP,NAICS2017&for=state:{fips}&NAICS2017=*"
STATE_FIPS = {"OK": "40"}
GROWTH_BOUNDS = (0.7, 1.6)
MIN_BASE_EMPLOYMENT = 500                # smaller industries are too noisy to use
# CPI-U annual averages (1982-84 = 100).
CPI_FALLBACK = {2017: 245.1, 2018: 251.1, 2019: 255.7, 2020: 258.8, 2021: 271.0, 2022: 292.7,
                2023: 304.7, 2024: 313.7, 2025: 322.0}


def fetch(state="OK"):
    from netutil import urlopen
    out = {"fetched": int(time.time()), "cpi": dict(CPI_FALLBACK), "growth": {}, "growth_years": None}
    try:
        with urlopen(FRED_CPI, timeout=15) as r:
            by_year = {}
            for line in r.read().decode().splitlines()[1:]:
                day, value = line.split(",")
                if value not in ("", "."):
                    by_year.setdefault(int(day[:4]), []).append(float(value))
        for y, vals in by_year.items():
            if y >= 2017:
                out["cpi"][y] = round(sum(vals) / len(vals), 1)   # the current year's partial average is "now"
        print(f"adjust: CPI from FRED {sorted(out['cpi'].items())[-3:]}", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"adjust: FRED unavailable; built-in CPI figures through {max(CPI_FALLBACK)} ({e!r})", flush=True)
    key = os.environ.get("CENSUS_API_KEY", "").strip()
    if not key:
        print("adjust: no CENSUS_API_KEY; industry growth not applied", flush=True)
    else:
        def employment(year):
            with urlopen(CBP.format(year=year, fips=STATE_FIPS[state]) + f"&key={key}", timeout=120) as r:
                rows = json.loads(r.read())
            head = rows[0]
            ie, i_n = head.index("EMP"), head.index("NAICS2017")
            out_ = {}
            for row in rows[1:]:
                code = row[i_n].replace("-", "")
                if code.isdigit() and str(row[ie]).isdigit():
                    out_[code] = max(out_.get(code, 0), float(row[ie]))
            return out_
        try:
            base = employment(BASE_YEAR)
            for latest in range(time.gmtime().tm_year - 1, BASE_YEAR, -1):
                try:
                    now = employment(latest)
                    break
                except Exception:  # noqa: BLE001  (not published yet)
                    continue
            else:
                raise RuntimeError("no County Business Patterns year after 2020")
            for code, b in base.items():
                if b >= MIN_BASE_EMPLOYMENT and now.get(code):
                    out["growth"][code] = round(now[code] / b, 3)
            out["growth_years"] = [BASE_YEAR, latest]
            print(f"adjust: {state} employment growth {BASE_YEAR}-{latest} for {len(out['growth']):,} industries", flush=True)
        except Exception as e:  # noqa: BLE001
            print(f"adjust: County Business Patterns unavailable; no growth adjustment ({e!r})", flush=True)
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
    ap.add_argument("--state", default="OK")
    args = ap.parse_args()
    if args.fetch:
        cached = json.load(open(CACHE)) if os.path.exists(CACHE) else {}
        fresh = os.path.exists(CACHE) and time.time() - os.path.getmtime(CACHE) < REFRESH_DAYS * 86400
        # Refetch early once a Census key appears, to pick up industry growth.
        if fresh and (cached.get("growth") or not os.environ.get("CENSUS_API_KEY")):
            print("adjust: cache is recent; skipping download", flush=True)
        else:
            fetch(args.state.upper())
    a = Adjust()
    print(f"  inflation 2019 -> now: {a.inflation(2019)}, 2022 -> now: {a.inflation(2022)}")
    for code in ("561730", "562991", "423320", "423430", "238220", "722511"):
        print(f"  growth {code}: {a.growth(code)}")
