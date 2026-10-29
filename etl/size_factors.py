"""Revenue per employee by company size, from the Census Statistics of U.S. Businesses (SUSB 2022).

    python etl/size_factors.py --fetch   # refresh data/cache/susb_rpe_v2.json
    python etl/size_factors.py           # print examples

An industry's average revenue per employee is pulled up by its largest firms (national distributors,
chains): a 40-person building-materials wholesaler doesn't sell what Oklahoma's biggest one does per
head. SUSB reports receipts and employment by enterprise size for every 6-digit industry, so the
estimate uses the figure for companies of the business's own size:

    revenue per employee = national figure for its size band x local adjustment

where the local adjustment is the industry benchmark (Oklahoma's figure where we have one) over the
national all-sizes figure, kept within LOCAL_BOUNDS so one large local firm can't dominate, and the
size band's figure is kept within BAND_BOUNDS of the all-sizes one.
"""
import argparse
import csv
import io
import json
import os
import time

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "..", "data", "cache", "susb_rpe_v2.json")   # v2 adds payroll shares
URL = "https://www2.census.gov/programs-surveys/susb/tables/2022/us_state_6digitnaics_2022.txt"
REFRESH_DAYS = 180
# Enterprise employment size codes in the file -> lower bound of the band.
BANDS = {"02": 0, "03": 5, "26": 10, "34": 20, "35": 100, "36": 500}
MIN_EMPLOYMENT = 50          # a band with fewer employees nationally is too thin to use
LOCAL_BOUNDS = (0.8, 1.25)
# The national 500+ band is set by the giants (an Oklahoma firm of 2,000 isn't Exxon or McKesson), so the
# size adjustment is kept within BAND_BOUNDS of the industry's all-sizes figure.
BAND_BOUNDS = (0.6, 1.6)


def fetch():
    from netutil import urlopen
    out = {}
    with urlopen(URL, timeout=600) as r:
        for row in csv.DictReader(io.TextIOWrapper(r, "latin-1")):
            if row["STATE"] != "00" or not row["NAICS"].isdigit():
                continue
            size = row["ENTRSIZE"]
            if size != "01" and size not in BANDS:
                continue
            try:
                empl, rcpt = int(row["EMPL"]), float(row["RCPT"]) * 1000   # receipts in $1,000s
                payr = float(row["PAYR"]) * 1000
            except (ValueError, KeyError):
                continue
            if empl < MIN_EMPLOYMENT or rcpt <= 0:
                continue
            entry = out.setdefault(row["NAICS"], {"total": None, "bands": {}, "pay_total": None, "pay": {}})
            share = round(payr / rcpt, 4) if payr > 0 else None
            if size == "01":
                entry["total"], entry["pay_total"] = round(rcpt / empl), share
            else:
                entry["bands"][str(BANDS[size])] = round(rcpt / empl)
                if share:
                    entry["pay"][str(BANDS[size])] = share
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    with open(CACHE + ".tmp", "w") as f:
        json.dump(out, f)
    os.replace(CACHE + ".tmp", CACHE)
    print(f"size_factors: revenue per employee by size for {len(out):,} industries (SUSB 2022)", flush=True)


class SizeFactors:
    def __init__(self):
        self.data = {}
        if os.path.exists(CACHE):
            with open(CACHE) as f:
                self.data = json.load(f)

    def _band(self, employees):
        return str(max(lo for lo in BANDS.values() if employees >= lo))

    def rpe(self, naics, employees, bench_rpe):
        """Revenue per employee for a company of this size; bench_rpe when SUSB has nothing usable."""
        if not bench_rpe or not employees or not self.data:
            return bench_rpe
        code, band = str(naics or ""), self._band(employees)
        for n in range(min(len(code), 6), 1, -1):
            entry = self.data.get(code[:n])
            if entry and entry.get("total") and entry["bands"].get(band):
                lo, hi = LOCAL_BOUNDS
                local = min(hi, max(lo, bench_rpe / entry["total"]))
                b_lo, b_hi = BAND_BOUNDS
                size = min(b_hi, max(b_lo, entry["bands"][band] / entry["total"]))
                return entry["total"] * size * local
        return bench_rpe


    def payroll_share(self, naics, employees, bench_share):
        """Payroll as a share of revenue for a company of this size (small firms spend more of their
        revenue on payroll); bench_share when SUSB has nothing usable. Same bounds as rpe()."""
        if not bench_share or not employees or not self.data:
            return bench_share
        code, band = str(naics or ""), self._band(employees)
        for n in range(min(len(code), 6), 1, -1):
            entry = self.data.get(code[:n])
            if entry and entry.get("pay_total") and entry.get("pay", {}).get(band):
                lo, hi = LOCAL_BOUNDS
                local = min(hi, max(lo, bench_share / entry["pay_total"]))
                b_lo, b_hi = BAND_BOUNDS
                size = min(b_hi, max(b_lo, entry["pay"][band] / entry["pay_total"]))
                return entry["pay_total"] * size * local
        return bench_share


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--fetch", action="store_true")
    if ap.parse_args().fetch:
        fresh = os.path.exists(CACHE) and time.time() - os.path.getmtime(CACHE) < REFRESH_DAYS * 86400
        if fresh:
            print("size_factors: cache is recent; skipping download", flush=True)
        else:
            fetch()
    s = SizeFactors()
    for code, emp, bench in (("423320", 41, 1_500_000), ("561730", 30, 150_000), ("423430", 9, 1_200_000), ("562991", 52, 180_000)):
        print(f"  {code} {emp} employees: benchmark ${bench:,} -> ${s.rpe(code, emp, bench):,.0f}")
