"""EBITDA margins from IRS tax returns, by industry and adjusted for company size.

    python etl/margins.py --fetch     # download IRS SOI tables, write data/cache/irs_margins.json
    python etl/margins.py             # print what would be used

Source: IRS Statistics of Income, Corporation Complete Report, Form 1120-S (S corporations: the
usual structure for small and mid-sized businesses), tax years 2019-2022 pooled:
  - Table 6.1: income statement by industry (about 80 industries, mostly 3-digit NAICS)
  - Table 3.2: income statement by size of business receipts (all industries)

EBITDA = net income from the business + interest paid + depreciation + depletion + amortization.
An industry's margin is its pooled EBITDA / business receipts. Smaller companies run higher
margins (owners often take distributions rather than salary), so each business's margin is the
industry margin x (margin of companies its size / margin of all companies), bounded.

Without the cache (no download yet) the sector defaults in benchmarks.py are used unchanged.
"""
import argparse
import io
import json
import os
import re
import sys
import time

from benchmarks import load_benchmarks, lookup

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "..", "data", "cache", "irs_margins.json")
BASE = "https://www.irs.gov/pub/irs-soi/{yy}co{table}ccr.xlsx"
YEARS = [19, 20, 21, 22]
REFRESH_DAYS = 90
SIZE_FACTOR_BOUNDS = (0.7, 1.6)
MARGIN_BOUNDS = (0.02, 0.45)
SOURCE = "IRS SOI S-corporation returns 2019-2022"

# IRS industry column (first header segment, lower case) -> NAICS prefixes it covers. Names
# changed with NAICS 2022, so both spellings are listed where they differ.
INDUSTRY_NAICS = [
    (r"^agricultural production", ["111", "112"]),
    (r"^forestry and logging", ["113"]),
    (r"^support activities and fishing", ["114", "115"]),
    (r"^mining", ["21"]),
    (r"^utilities", ["22"]),
    (r"^construction of buildings", ["236"]),
    (r"^heavy and civil", ["237"]),
    (r"^specialty trade", ["238"]),
    (r"^food manufacturing", ["311"]),
    (r"^beverage and tobacco", ["312"]),
    (r"^textile mills", ["313", "314"]),
    (r"^apparel manufacturing", ["315"]),
    (r"^leather", ["316"]),
    (r"^wood product", ["321"]),
    (r"^paper manufacturing", ["322"]),
    (r"^printing", ["323"]),
    (r"^petroleum and coal", ["324"]),
    (r"^chemical manufacturing", ["325"]),
    (r"^plastics and rubber", ["326"]),
    (r"^nonmetallic mineral product", ["327"]),
    (r"^primary metal", ["331"]),
    (r"^fabricated metal", ["332"]),
    (r"^machinery manufacturing", ["333"]),
    (r"^computer and electronic product", ["334"]),
    (r"^electrical equipment", ["335"]),
    (r"^transportation equipment", ["336"]),
    (r"^furniture and related product", ["337"]),
    (r"^miscellaneous manufacturing", ["339"]),
    (r"^durable goods", ["423"]),
    (r"^nondurable\s+goods", ["424"]),
    (r"agents and brokers", ["425"]),
    (r"^motor vehicle", ["441"]),
    (r"^furniture, home furnishings, electronics", ["442", "443", "449"]),
    (r"^furniture and home furnishings stores", ["442", "449"]),
    (r"^electronics and appliance stores", ["443"]),
    (r"^building material", ["444"]),
    (r"^food, beverage", ["445"]),
    (r"^health and personal care", ["446", "456"]),
    (r"^gasoline stations", ["447", "457"]),
    (r"^clothing", ["448", "458"]),
    (r"^sporting goods", ["451", "459"]),
    (r"^general merchandise", ["452", "455"]),
    (r"^miscellaneous store retailers", ["453"]),
    (r"^nonstore retailers", ["454"]),
    (r"^air, rail, and water", ["481", "482", "483"]),
    (r"^truck transportation", ["484"]),
    (r"^transit and ground", ["485"]),
    (r"^pipeline transportation", ["486"]),
    (r"^other transportation and support", ["487", "488", "492"]),
    (r"^warehousing", ["493"]),
    (r"^publishing", ["511", "513"]),
    (r"^motion picture", ["512"]),
    (r"^broadcasting", ["515", "516"]),
    (r"^telecommunications", ["517"]),
    (r"data processing|computing infrastructure", ["518"]),
    (r"^web search|^other information", ["519"]),
    (r"^depository credit", ["5221"]),
    (r"^nondepository credit", ["5222", "5223"]),
    (r"^securities", ["523"]),
    (r"^insurance carriers", ["524"]),
    (r"^funds, trusts", ["525"]),
    (r"^real estate$", ["531"]),
    (r"^rental and leasing", ["532"]),
    (r"^lessors of nonfinancial", ["533"]),
    (r"^professional, scientific", ["54"]),
    (r"^management of companies", ["55"]),
    (r"^administrative and support services", ["561"]),
    (r"^waste management", ["562"]),
    (r"^educational services", ["61"]),
    (r"^offices of health", ["621"]),
    (r"^miscellaneous health care", ["624"]),
    (r"^hospitals", ["622", "623"]),
    (r"^other arts", ["711", "712"]),
    (r"^amusement, gambling", ["713"]),
    (r"^accommodation$", ["721"]),
    (r"^food services", ["722"]),
    (r"^repair and maintenance", ["811"]),
    (r"^personal and laundry", ["812"]),
    (r"^religious, grantmaking", ["813"]),
]
# Sector "Total" columns, used where an industry column is suppressed or unmapped.
SECTOR_NAICS = [
    (r"^agriculture", ["11"]), (r"^construction", ["23"]), (r"^manufacturing", ["31", "32", "33"]),
    (r"^wholesale", ["42"]), (r"^retail", ["44", "45"]), (r"^transportation and warehousing", ["48", "49"]),
    (r"^information", ["51"]), (r"^finance and insurance", ["52"]), (r"^real estate and rental", ["53"]),
    (r"^administrative and support and", ["56"]), (r"^health care and social", ["62"]),
    (r"^arts, entertainment", ["71"]), (r"^accommodation and food", ["72"]), (r"^other services", ["81"]),
]
ITEMS = {
    "receipts": "business receipts",
    "net": "net income (less deficit)",
    "interest": "interest paid",
    "depreciation": "depreciation",
    "depletion": "depletion",
    "amortization": "amortization",
}


def _num(v):
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).replace(",", "").strip())
    except ValueError:
        return None   # "d" (suppressed) or blank


def _sheet(year, table):
    import openpyxl
    sys.path.insert(0, HERE)
    from netutil import urlopen
    with urlopen(BASE.format(yy=year, table=table), timeout=180) as r:
        data = r.read()
    rows = list(openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True).worksheets[0]
                .iter_rows(values_only=True))
    first = next(i for i, r in enumerate(rows) if r and r[0] and str(r[0]).strip().lower().startswith("number of returns"))
    return rows, first


def _items(rows, first, col):
    """{item: value} for one column; None if any needed item is suppressed."""
    found = {}
    for r in rows[first:]:
        label = str(r[0] or "").strip().lower()
        for key, prefix in ITEMS.items():
            if key not in found and label.startswith(prefix):
                found[key] = _num(r[col]) if col < len(r) else None
    if any(found.get(k) is None for k in ITEMS) or not found["receipts"]:
        return None
    return found


def _ebitda(it):
    return it["net"] + it["interest"] + it["depreciation"] + it["depletion"] + it["amortization"]


def fetch():
    industries, sectors, overall = {}, {}, [0.0, 0.0]
    bands = {}
    for yy in YEARS:
        try:
            rows, first = _sheet(yy, "61")
        except Exception as e:  # noqa: BLE001
            print(f"IRS margins: table 6.1 for 20{yy} unavailable ({e!r})", flush=True)
            continue
        ncols = max(len(r) for r in rows)
        unmapped = []
        for c in range(1, ncols):
            parts = [str(rows[i][c]).replace("\n", " ").strip() for i in range(first)
                     if c < len(rows[i]) and rows[i][c] not in (None, "") and not str(rows[i][c]).strip().isdigit()]
            if not parts:
                continue
            name = re.sub(r"\s+", " ", parts[0]).lower()
            is_total = any(p.lower() == "total" for p in parts[1:])
            it = _items(rows, first, c)
            if not it:
                continue
            if name.startswith("all industries"):
                overall[0] += _ebitda(it)
                overall[1] += it["receipts"]
                continue
            table = SECTOR_NAICS if is_total else INDUSTRY_NAICS
            hit = next((codes for pat, codes in table if re.search(pat, name)), None)
            if hit is None and not is_total:   # single-column sectors (Mining, Utilities, ...)
                hit = next((codes for pat, codes in INDUSTRY_NAICS if re.search(pat, name)), None)
            if hit is None:
                unmapped.append(name)
                continue
            target = sectors if is_total else industries
            for code in hit:
                acc = target.setdefault(code, {"ebitda": 0.0, "receipts": 0.0, "label": parts[0]})
                acc["ebitda"] += _ebitda(it)
                acc["receipts"] += it["receipts"]
        if unmapped:
            print(f"IRS margins: 20{yy} unmapped industry columns: {unmapped}", flush=True)
        try:
            rows, first = _sheet(yy, "32")
        except Exception as e:  # noqa: BLE001
            print(f"IRS margins: table 3.2 for 20{yy} unavailable ({e!r})", flush=True)
            continue
        header = next(r for r in rows[:first] if r and any("under" in str(c).lower() for c in r if c))
        for c, text in enumerate(header):
            low = _band_floor(text)
            if low is None:
                continue
            it = _items(rows, first, c)
            if it:
                acc = bands.setdefault(low, [0.0, 0.0])
                acc[0] += _ebitda(it)
                acc[1] += it["receipts"]
        print(f"IRS margins: read 20{yy}", flush=True)
    if not overall[1] or not industries:
        sys.exit("IRS margins: no usable tables; sector defaults stay in use")
    base = overall[0] / overall[1]
    out = {
        "source": SOURCE, "fetched": int(time.time()), "overall": round(base, 4),
        "industries": {k: {"margin": round(v["ebitda"] / v["receipts"], 4), "label": v["label"]}
                       for k, v in industries.items() if v["receipts"] > 0},
        "sectors": {k: {"margin": round(v["ebitda"] / v["receipts"], 4), "label": v["label"]}
                    for k, v in sectors.items() if v["receipts"] > 0},
        # Lower bound of each receipts band -> that band's margin relative to all companies.
        "size_factors": sorted([low, round((e / r) / base, 3)] for low, (e, r) in bands.items() if r > 0 and low >= 25_000),
    }
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    with open(CACHE + ".tmp", "w") as f:
        json.dump(out, f, indent=1)
    os.replace(CACHE + ".tmp", CACHE)
    print(f"IRS margins: {len(out['industries'])} industries, {len(out['sectors'])} sectors, all companies "
          f"{base:.1%}; size factors {out['size_factors']}", flush=True)


def _band_floor(text):
    """'$1,000,000\\nunder\\n$2,500,000' -> 1000000; 'Under $25,000' -> 0; 'Total' -> None."""
    s = str(text or "").lower().replace("\n", " ")
    if "under" not in s and "more" not in s:
        return None
    if s.strip().startswith("under"):
        return 0
    m = re.search(r"\$([\d,]+)", s)
    return int(m.group(1).replace(",", "")) if m else None


class Margins:
    """margin(naics, revenue) -> (margin, basis); falls back to benchmarks.py sector defaults."""

    def __init__(self):
        self.bench = load_benchmarks()
        self.data = None
        if os.path.exists(CACHE):
            with open(CACHE) as f:
                self.data = json.load(f)

    def industry(self, naics):
        code = str(naics or "")
        if self.data:
            for table in ("industries", "sectors"):
                for n in range(len(code), 1, -1):
                    hit = self.data[table].get(code[:n])
                    if hit:
                        return hit["margin"], hit["label"]
        _, b = lookup(self.bench, code)
        return b["ebitda_margin"], None

    def size_factor(self, revenue):
        if not self.data or not revenue:
            return 1.0
        factor = 1.0
        for low, f in self.data["size_factors"]:
            if revenue >= low:
                factor = f
        lo, hi = SIZE_FACTOR_BOUNDS
        return min(hi, max(lo, factor))

    def margin(self, naics, revenue):
        base, label = self.industry(naics)
        if label is None:   # no IRS data: the old sector default, unadjusted
            return base
        lo, hi = MARGIN_BOUNDS
        return round(min(hi, max(lo, base * self.size_factor(revenue))), 4)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--fetch", action="store_true", help="download IRS tables (skipped if cached recently)")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    if a.fetch:
        fresh = os.path.exists(CACHE) and time.time() - os.path.getmtime(CACHE) < REFRESH_DAYS * 86400
        if fresh and not a.force:
            print("IRS margins: cache is recent; skipping download", flush=True)
        else:
            fetch()
    m = Margins()
    for code, rev in [("562991", 2e6), ("561720", 1e6), ("238220", 3e6), ("722511", 1.5e6), ("541330", 5e6)]:
        print(f"  {code} at ${rev:,.0f}: industry {m.industry(code)} -> margin {m.margin(code, rev):.1%}")
