"""Industry ratios used to turn PPP-implied payroll into revenue and EBITDA.

SECTOR_DEFAULTS are rounded, sector-level approximations of US Economic Census
payroll/receipts and receipts/employee, plus rough small-business EBITDA margins.
They are placeholders so the pipeline works end to end. Run

    python etl/benchmarks.py --fetch

with internet access to replace them with exact Census figures down to 6-digit
NAICS (written to data/benchmarks.csv, which takes precedence).
"""
import argparse
import csv
import json
import os
import sys

from netutil import urlopen

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "..", "data")
BENCH_CSV = os.path.join(DATA_DIR, "benchmarks.csv")

# prefix: (label, payroll_to_revenue, revenue_per_employee, ebitda_margin)
SECTOR_DEFAULTS = {
    "11": ("Agriculture, Forestry, Fishing", 0.15, 250_000, 0.12),
    "21": ("Mining, Oil & Gas Extraction", 0.12, 1_000_000, 0.25),
    "22": ("Utilities", 0.08, 1_000_000, 0.30),
    "23": ("Construction", 0.22, 270_000, 0.09),
    "31": ("Manufacturing", 0.12, 500_000, 0.12),
    "32": ("Manufacturing", 0.12, 500_000, 0.12),
    "33": ("Manufacturing", 0.12, 500_000, 0.12),
    "42": ("Wholesale Trade", 0.06, 1_000_000, 0.05),
    "44": ("Retail Trade", 0.10, 300_000, 0.06),
    "45": ("Retail Trade", 0.10, 300_000, 0.06),
    "48": ("Transportation & Warehousing", 0.26, 200_000, 0.12),
    "49": ("Transportation & Warehousing", 0.26, 200_000, 0.12),
    "51": ("Information", 0.20, 500_000, 0.20),
    "52": ("Finance & Insurance", 0.20, 600_000, 0.25),
    "53": ("Real Estate & Rental", 0.15, 330_000, 0.25),
    "54": ("Professional, Scientific & Technical Services", 0.38, 230_000, 0.15),
    "55": ("Management of Companies", 0.45, 300_000, 0.15),
    "56": ("Administrative & Waste Services", 0.40, 85_000, 0.08),
    "61": ("Educational Services", 0.38, 100_000, 0.08),
    "62": ("Health Care & Social Assistance", 0.40, 120_000, 0.12),
    "71": ("Arts, Entertainment & Recreation", 0.30, 110_000, 0.12),
    "72": ("Accommodation & Food Services", 0.30, 70_000, 0.10),
    "81": ("Other Services", 0.33, 110_000, 0.10),
    "92": ("Public Administration", 0.40, 100_000, 0.05),
}
FALLBACK = ("Unclassified", 0.25, 150_000, 0.10)
DEFAULT_SOURCE = "approximate sector default"


def load_benchmarks():
    """Return {prefix: dict} combining defaults with data/benchmarks.csv if present."""
    out = {
        p: {"label": l, "payroll_to_revenue": r, "revenue_per_employee": e,
            "ebitda_margin": m, "source": DEFAULT_SOURCE}
        for p, (l, r, e, m) in SECTOR_DEFAULTS.items()
    }
    if os.path.exists(BENCH_CSV):
        with open(BENCH_CSV, newline="") as f:
            for row in csv.DictReader(f):
                sector = out.get(row["naics_prefix"][:2], {})
                out[row["naics_prefix"]] = {
                    "label": row["label"],
                    "payroll_to_revenue": float(row["payroll_to_revenue"]),
                    "revenue_per_employee": float(row["revenue_per_employee"] or 0) or None,
                    # Census has no margins; inherit the sector margin.
                    "ebitda_margin": float(row.get("ebitda_margin") or 0)
                    or sector.get("ebitda_margin", FALLBACK[3]),
                    "source": row["source"],
                }
    return out


def lookup(benchmarks, naics):
    """Most specific benchmark matching the NAICS code (6 digits down to 2)."""
    naics = (naics or "").strip()
    for n in range(min(len(naics), 6), 1, -1):
        b = benchmarks.get(naics[:n])
        if b:
            return naics[:n], b
    l, r, e, m = FALLBACK
    return None, {"label": l, "payroll_to_revenue": r, "revenue_per_employee": e,
                  "ebitda_margin": m, "source": DEFAULT_SOURCE}


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


STATE_FIPS = {"OK": "40", "TX": "48", "KS": "20", "AR": "05", "MO": "29"}
MIN_STATE_EMPLOYEES = 300   # below this a state's figure for an industry is too thin to trust


def _census_rows(url, ncol):
    """{naics: (label, receipts $k, payroll $k, employees)} from one Economic Census API call."""
    with urlopen(url, timeout=120) as r:
        body = r.read().decode("utf-8", errors="replace")
    try:
        rows = json.loads(body)
    except ValueError as e:
        raise ValueError(f"{e}; response starts: {body[:300]!r}") from None
    header, rows = rows[0], rows[1:]
    idx = {h: i for i, h in enumerate(header)}
    best = {}
    for row in rows:
        code = row[idx[ncol]]
        rcpt, pay, emp = (_num(row[idx[k]]) for k in ("RCPTOT", "PAYANN", "EMP"))
        if not code.isdigit() or not rcpt or not pay or rcpt <= 0:
            continue
        # Several rows per code (tax status splits); the largest is the all-firms total.
        if code not in best or rcpt > best[code][1]:
            best[code] = (row[idx[f"{ncol}_LABEL"]], rcpt, pay, emp)
    return best


def fetch_census(state="OK"):
    """Pull receipts, payroll and employment by NAICS from the Economic Census API: national
    figures, replaced by the state's own where it has enough employees in that industry."""
    attempts = [
        ("2022", "NAICS2022", "https://api.census.gov/data/2022/ecnbasic"),
        ("2017", "NAICS2017", "https://api.census.gov/data/2017/ecnbasic"),
    ]
    key = os.environ.get("CENSUS_API_KEY")
    if not key:
        print("No CENSUS_API_KEY set (a free key from api.census.gov/data/key_signup.html, saved as a "
              "GitHub secret).", file=sys.stderr)
    suffix = f"&key={key}" if key else ""
    for year, ncol, base in attempts:
        fields = f"get={ncol},{ncol}_LABEL,RCPTOT,PAYANN,EMP&{ncol}=*"
        try:
            best = _census_rows(f"{base}?{fields}&for=us:*{suffix}", ncol)
        except Exception as e:  # noqa: BLE001
            print(f"Census {year} failed: {e}", file=sys.stderr)
            continue
        local = {}
        if state in STATE_FIPS:
            try:
                local = _census_rows(f"{base}?{fields}&for=state:{STATE_FIPS[state]}{suffix}", ncol)
            except Exception as e:  # noqa: BLE001
                print(f"Census {year} {state} figures failed (using national): {e}", file=sys.stderr)
        os.makedirs(DATA_DIR, exist_ok=True)
        used_local = 0
        with open(BENCH_CSV, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["naics_prefix", "label", "payroll_to_revenue",
                        "revenue_per_employee", "ebitda_margin", "source"])
            for code, (label, rcpt, pay, emp) in sorted(best.items()):
                source = f"US Economic Census {year}"
                st = local.get(code)
                if st and st[3] and st[3] >= MIN_STATE_EMPLOYEES:
                    _, rcpt, pay, emp = st
                    source = f"US Economic Census {year}, {state}"
                    used_local += 1
                rpe = round(rcpt * 1000 / emp) if emp else ""
                w.writerow([code, label, round(pay / rcpt, 4), rpe, "", source])
        print(f"Wrote {len(best)} benchmarks from Economic Census {year} to {BENCH_CSV} "
              f"({used_local} using {state} figures)")
        return
    sys.exit("Could not reach the Census API; sector defaults will be used.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--fetch", action="store_true", help="download Census benchmarks")
    ap.add_argument("--state", default="OK", help="prefer this state's figures where reliable")
    a = ap.parse_args()
    if a.fetch:
        fetch_census(a.state.upper())
    else:
        print(json.dumps(load_benchmarks(), indent=1))
