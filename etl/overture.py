"""Building-level coordinates from Overture Maps open data (addresses + building footprints).

For each business, in order of preference:
  1. 'rooftop'  - its exact address appears in Overture's address points (county/city address data);
  2. 'place'    - a business with a matching name appears in Overture places near its street location;
  3. 'building' - the address is placed between same-street, same-side (odd/even) neighbours from
                  Overture, or failing that at the Census street point, then moved onto the nearest
                  building footprint.
Everything is read straight from Overture's public S3 bucket, filtered to the state's bounding box,
and cached under data/ per release.
"""
import math
import os
import re
from collections import defaultdict

import pyarrow.compute as pc
import pyarrow.dataset as ds
import pyarrow.fs as pafs
import pyarrow.parquet as pq

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "..", "data")
BUCKET = "overturemaps-us-west-2"
BOUNDS = {"OK": (-103.1, 33.6, -94.4, 37.1)}   # west, south, east, north
SNAP_METERS = 80          # max distance from a street point to a building edge (parking lots)
NEIGHBOUR_SPAN = 200      # max house-number gap to interpolate between neighbours
MIN_BUILDING_M2 = 60      # ignore sheds and carports
PLACE_RADIUS_M = 1_500    # how far from the street point a same-name place may be
PLACE_MIN_SCORE = 0.6     # name similarity (0-1) needed for a place match
NAME_NOISE = {"LLC", "L", "C", "INC", "INCORPORATED", "CORP", "CORPORATION", "CO", "COMPANY", "LTD", "PLLC",
              "PC", "LP", "LLP", "PA", "DBA", "THE", "OF", "AND", "OKLAHOMA", "OK", "OKC", "TULSA"}

SUFFIX = {
    "STREET": "ST", "AVENUE": "AVE", "AV": "AVE", "BOULEVARD": "BLVD", "DRIVE": "DR", "ROAD": "RD",
    "LANE": "LN", "COURT": "CT", "PLACE": "PL", "PARKWAY": "PKWY", "HIGHWAY": "HWY", "TERRACE": "TER",
    "CIRCLE": "CIR", "EXPRESSWAY": "EXPY", "FREEWAY": "FWY", "TRAIL": "TRL", "SQUARE": "SQ",
    "CENTER": "CTR", "PLAZA": "PLZ", "POINT": "PT", "CROSSING": "XING", "TURNPIKE": "TPKE",
}
DIRECTION = {
    "NORTH": "N", "SOUTH": "S", "EAST": "E", "WEST": "W", "NORTHWEST": "NW", "NORTHEAST": "NE",
    "SOUTHWEST": "SW", "SOUTHEAST": "SE",
}
UNIT_WORDS = {"STE", "SUITE", "UNIT", "APT", "BLDG", "BUILDING", "RM", "ROOM", "FL", "FLOOR", "SPC", "LOT", "DEPT"}


def _fs():
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    kw = {"anonymous": True, "region": "us-west-2"}
    if proxy:
        kw["proxy_options"] = proxy
    return pafs.S3FileSystem(**kw)


def latest_release(fs):
    infos = fs.get_file_info(pafs.FileSelector(f"{BUCKET}/release/"))
    return sorted(i.base_name for i in infos if i.type == pafs.FileType.Directory)[-1]


def _fetch(fs, release, theme, kind, columns, bounds, extra_filter=None):
    west, south, east, north = bounds
    x, y = pc.field("bbox", "xmin"), pc.field("bbox", "ymin")
    flt = (x >= west) & (x <= east) & (y >= south) & (y <= north)
    if extra_filter is not None:
        flt = flt & extra_filter
    dataset = ds.dataset(f"{BUCKET}/release/{release}/theme={theme}/type={kind}/", filesystem=fs, format="parquet")
    return dataset.to_table(columns=columns, filter=flt)


def load_layers(state):
    """Return (release, addresses, buildings, places tables), downloading once per release."""
    fs = _fs()
    release = os.environ.get("OVERTURE_RELEASE") or latest_release(fs)
    bounds = BOUNDS[state]
    os.makedirs(DATA_DIR, exist_ok=True)
    addr_path = os.path.join(DATA_DIR, f"overture_{state.lower()}_addresses_{release}.parquet")
    bld_path = os.path.join(DATA_DIR, f"overture_{state.lower()}_buildings_{release}.parquet")
    if not os.path.exists(addr_path):
        print(f"Overture {release}: downloading {state} address points…", flush=True)
        t = _fetch(fs, release, "addresses", "address", {
            "number": pc.field("number"), "street": pc.field("street"), "postcode": pc.field("postcode"),
            "lon": pc.field("bbox", "xmin"), "lat": pc.field("bbox", "ymin"),
        }, bounds, pc.field("country") == "US")
        pq.write_table(t, addr_path)
    if not os.path.exists(bld_path):
        print(f"Overture {release}: downloading {state} building footprints…", flush=True)
        t = _fetch(fs, release, "buildings", "building", {
            "xmin": pc.field("bbox", "xmin"), "xmax": pc.field("bbox", "xmax"),
            "ymin": pc.field("bbox", "ymin"), "ymax": pc.field("bbox", "ymax"),
        }, bounds)
        pq.write_table(t, bld_path)
    places_path = os.path.join(DATA_DIR, f"overture_{state.lower()}_places_{release}.parquet")
    if not os.path.exists(places_path):
        print(f"Overture {release}: downloading {state} places…", flush=True)
        t = _fetch(fs, release, "places", "place", {
            "name": pc.field("names", "primary"), "confidence": pc.field("confidence"),
            "lon": pc.field("bbox", "xmin"), "lat": pc.field("bbox", "ymin"),
        }, bounds)
        pq.write_table(t, places_path)
    return release, pq.read_table(addr_path), pq.read_table(bld_path), pq.read_table(places_path)


def parse_address(addr):
    """'13209 N Santa Fe Avenue Ste 100' -> ('13209', 'N SANTA FE AVE'); None for PO boxes etc."""
    s = re.sub(r"[^A-Z0-9 ]", " ", (addr or "").upper().replace("#", " STE "))
    tokens = s.split()
    if not tokens or not re.match(r"^\d+[A-Z]?$", tokens[0]):
        return None
    number = re.match(r"^\d+", tokens[0]).group()
    street = []
    for tok in tokens[1:]:
        if tok in UNIT_WORDS:
            break
        street.append(SUFFIX.get(tok, DIRECTION.get(tok, tok)))
    return (number, " ".join(street)) if street else None


def normalize_street(street):
    parsed = parse_address(f"0 {street or ''}")
    return parsed[1] if parsed else ""


def _core(street):
    """Street name without directionals and suffix type, for looser matching."""
    words = [w for w in street.split() if w not in DIRECTION.values() and w not in SUFFIX.values()]
    return " ".join(words) or street


def _meters(lat):
    return 111_320 * math.cos(math.radians(lat)), 110_540   # metres per degree lon, lat


class BuildingIndex:
    CELL = 0.001  # degrees, ~100 m

    def __init__(self, table):
        self.cells = defaultdict(list)
        cols = [table.column(c).to_pylist() for c in ("xmin", "xmax", "ymin", "ymax")]
        kept = 0
        for x0, x1, y0, y1 in zip(*cols):
            mx, my = _meters(y0)
            if (x1 - x0) * mx * (y1 - y0) * my < MIN_BUILDING_M2:
                continue
            rect = (x0, x1, y0, y1)
            for cx in range(int(x0 // self.CELL), int(x1 // self.CELL) + 1):
                for cy in range(int(y0 // self.CELL), int(y1 // self.CELL) + 1):
                    self.cells[(cx, cy)].append(rect)
            kept += 1
        print(f"Indexed {kept:,} building footprints", flush=True)

    def snap(self, lat, lon, max_m=SNAP_METERS):
        """Centre of the building whose outline is nearest (within max_m), or None."""
        mx, my = _meters(lat)
        reach = int(math.ceil(max_m / 111_000 / self.CELL)) + 1
        cx, cy = int(lon // self.CELL), int(lat // self.CELL)
        best, best_d = None, max_m
        for i in range(cx - reach, cx + reach + 1):
            for j in range(cy - reach, cy + reach + 1):
                for x0, x1, y0, y1 in self.cells.get((i, j), ()):
                    dx = max(x0 - lon, 0, lon - x1) * mx
                    dy = max(y0 - lat, 0, lat - y1) * my
                    d = math.hypot(dx, dy)
                    if d < best_d or (d == best_d == 0 and best is not None and
                                      (x1 - x0) * (y1 - y0) < (best[1] - best[0]) * (best[3] - best[2])):
                        best, best_d = (x0, x1, y0, y1), d
        if best is None:
            return None
        return (best[2] + best[3]) / 2, (best[0] + best[1]) / 2


class AddressIndex:
    def __init__(self, table):
        self.exact = {}
        self.loose = defaultdict(list)
        self.by_street = defaultdict(list)   # (core street, zip) -> [(number, lat, lon)]
        rows = zip(*(table.column(c).to_pylist() for c in ("number", "street", "postcode", "lat", "lon")))
        for number, street, postcode, lat, lon in rows:
            if not number or not street or lat is None:
                continue
            m = re.match(r"^\d+", number.strip())
            if not m:
                continue
            n, st, z = m.group(), normalize_street(street), (postcode or "")[:5]
            self.exact.setdefault((n, st, z), (lat, lon))
            self.loose[(n, _core(st), z)].append((lat, lon))
            self.by_street[(_core(st), z)].append((int(n), lat, lon))
        print(f"Indexed {len(self.exact):,} Overture address points", flush=True)

    def find(self, number, street, zip5):
        hit = self.exact.get((number, street, zip5))
        if hit:
            return hit
        loose = self.loose.get((number, _core(street), zip5), [])
        return loose[0] if len(loose) == 1 else None

    def interpolate(self, number, street, zip5):
        """Position from same-street, same-side (odd/even) neighbouring house numbers."""
        n = int(number)
        side = [p for p in self.by_street.get((_core(street), zip5), ()) if p[0] % 2 == n % 2]
        lower = max((p for p in side if p[0] < n and n - p[0] <= NEIGHBOUR_SPAN), default=None)
        upper = min((p for p in side if p[0] > n and p[0] - n <= NEIGHBOUR_SPAN), default=None)
        if lower and upper:
            f = (n - lower[0]) / (upper[0] - lower[0])
            return lower[1] + f * (upper[1] - lower[1]), lower[2] + f * (upper[2] - lower[2])
        near = lower or upper
        if near and abs(near[0] - n) <= 20:
            return near[1], near[2]
        return None


def name_tokens(name):
    words = re.sub(r"[^A-Z0-9 ]", " ", (name or "").upper().replace("&", " AND ")).split()
    return frozenset(w for w in words if w not in NAME_NOISE and len(w) > 1)


def name_score(a, b):
    """Similarity of two token sets: overlap relative to the smaller set, damped for one-word names."""
    if not a or not b:
        return 0.0
    common = len(a & b)
    score = common / min(len(a), len(b))
    return score if common >= 2 or min(len(a), len(b)) == 1 else score * 0.8


class PlaceIndex:
    CELL = 0.01  # degrees, ~1 km

    def __init__(self, table):
        self.cells = defaultdict(list)
        rows = zip(*(table.column(c).to_pylist() for c in ("name", "confidence", "lat", "lon")))
        n = 0
        for name, conf, lat, lon in rows:
            tokens = name_tokens(name)
            if not tokens or lat is None or (conf or 0) < 0.4:
                continue
            self.cells[(int(lon // self.CELL), int(lat // self.CELL))].append((tokens, lat, lon))
            n += 1
        print(f"Indexed {n:,} Overture places", flush=True)

    def find(self, name, lat, lon):
        """Best same-name place within PLACE_RADIUS_M of (lat, lon), or None."""
        tokens = name_tokens(name)
        if not tokens:
            return None
        mx, my = _meters(lat)
        reach = int(math.ceil(PLACE_RADIUS_M / 111_000 / self.CELL))
        cx, cy = int(lon // self.CELL), int(lat // self.CELL)
        best, best_key = None, None
        for i in range(cx - reach, cx + reach + 1):
            for j in range(cy - reach, cy + reach + 1):
                for p_tokens, p_lat, p_lon in self.cells.get((i, j), ()):
                    score = name_score(tokens, p_tokens)
                    if score < PLACE_MIN_SCORE:
                        continue
                    d = math.hypot((p_lon - lon) * mx, (p_lat - lat) * my)
                    if d > PLACE_RADIUS_M:
                        continue
                    key = (score, -d)
                    if best_key is None or key > best_key:
                        best, best_key = (p_lat, p_lon), key
        return best


def place(state, rows):
    """rows: [(biz_key, name, address, zip5, lat, lon, street_level)] -> {biz_key: (lat, lon, precision)}

    lat/lon is the Census street-level point (street_level=True), or the ZIP centre when the Census
    had no match; the ZIP centre is only used to search for same-name places nearby.
    """
    release, addr_tbl, bld_tbl, places_tbl = load_layers(state)
    addresses, buildings, places = AddressIndex(addr_tbl), BuildingIndex(bld_tbl), PlaceIndex(places_tbl)
    out, counts = {}, defaultdict(int)
    for biz_key, name, address, zip5, s_lat, s_lon, street_level in rows:
        parsed = parse_address(address)
        if parsed:
            hit = addresses.find(parsed[0], parsed[1], zip5)
            if hit:
                snapped = buildings.snap(*hit, max_m=15) or hit
                out[biz_key] = (snapped[0], snapped[1], "rooftop")
                counts["exact address point"] += 1
                continue
        if s_lat is not None:
            hit = places.find(name, s_lat, s_lon)
            if hit:
                snapped = buildings.snap(*hit, max_m=20) or hit
                out[biz_key] = (snapped[0], snapped[1], "place")
                counts["business name match"] += 1
                continue
        if parsed:
            guess = addresses.interpolate(parsed[0], parsed[1], zip5)
            if guess:
                snapped = buildings.snap(*guess)
                if snapped:
                    out[biz_key] = (snapped[0], snapped[1], "building")
                    counts["neighbours + building"] += 1
                    continue
        if s_lat is not None and street_level:
            snapped = buildings.snap(s_lat, s_lon)
            if snapped:
                out[biz_key] = (snapped[0], snapped[1], "building")
                counts["street point + building"] += 1
                continue
        counts["no building found"] += 1
    print(f"Overture {release} placement: {dict(counts)}", flush=True)
    return out
