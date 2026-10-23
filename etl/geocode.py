"""Add lat/lon to data/businesses.csv.

    python etl/geocode.py               # ZIP centroids only (fast)
    python etl/geocode.py --addresses   # also street-level via the free Census batch geocoder

Individuals (sole props etc.) never get street-level points, only a jittered
ZIP centroid, so the map never pinpoints someone's home.
"""
import argparse
import csv
import hashlib
import io
import math
import os
import uuid
import zipfile
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

import overture
import rooftop
from netutil import urlopen
from csvio import write_rows

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "..", "data")
BIZ_CSV = os.path.join(DATA_DIR, "businesses.csv")
GAZ_URL = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_zcta_national.zip"
GAZ_TXT = os.path.join(DATA_DIR, "zcta_gazetteer.txt")
BATCH_URL = "https://geocoding.geo.census.gov/geocoder/locations/addressbatch"
BATCH_SIZE = 2_500           # Census allows 10k, but smaller batches fail less and run in parallel
WORKERS = 4
CACHE_CSV = os.path.join(DATA_DIR, "geocode_cache.csv")   # biz_key -> lat, lon ('' = no match)


def zip_centroids():
    if not os.path.exists(GAZ_TXT):
        with urlopen(GAZ_URL, timeout=300) as r:
            z = zipfile.ZipFile(io.BytesIO(r.read()))
        with open(GAZ_TXT, "wb") as f:
            f.write(z.read(z.namelist()[0]))
    out = {}
    with open(GAZ_TXT, newline="", encoding="utf-8") as f:
        reader = csv.reader(f, delimiter="\t")
        header = [h.strip() for h in next(reader)]
        gi, la, lo = header.index("GEOID"), header.index("INTPTLAT"), header.index("INTPTLONG")
        for row in reader:
            out[row[gi].strip()] = (float(row[la]), float(row[lo]))
    return out


def jitter(key, radius=0.008):
    """Deterministic offset within a disc so businesses in one ZIP don't stack on a single pin."""
    h = hashlib.md5(key.encode()).digest()
    angle = int.from_bytes(h[:4], "big") / 2**32 * 2 * math.pi
    r = radius * math.sqrt(int.from_bytes(h[4:8], "big") / 2**32)
    return r * math.sin(angle), r * math.cos(angle) / math.cos(math.radians(35.5))


def multipart(fields, file_field, filename, content):
    boundary = uuid.uuid4().hex
    parts = []
    for k, v in fields.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n')
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{file_field}"; '
                 f'filename="{filename}"\r\nContent-Type: text/csv\r\n\r\n')
    body = "".join(parts).encode() + content + f"\r\n--{boundary}--\r\n".encode()
    return body, f"multipart/form-data; boundary={boundary}"


def census_batch(rows):
    """rows: [(id, street, city, state, zip)] -> {id: (lat, lon)}"""
    buf = io.StringIO()
    csv.writer(buf).writerows(rows)
    body, ctype = multipart({"benchmark": "Public_AR_Current"}, "addressFile",
                            "addresses.csv", buf.getvalue().encode())
    with urlopen(BATCH_URL, data=body, headers={"Content-Type": ctype}, timeout=1800) as r:
        text = r.read().decode("utf-8", errors="replace")
    out = {}
    for rec in csv.reader(io.StringIO(text)):
        if len(rec) >= 6 and rec[2] == "Match" and "," in rec[5]:
            lon, lat = rec[5].split(",")
            out[rec[0]] = (float(lat), float(lon))
    return out


def census_batch_retry(rows, attempts=3):
    for n in range(1, attempts + 1):
        try:
            return census_batch(rows)
        except Exception as e:  # noqa: BLE001
            print(f"batch of {len(rows)} failed (attempt {n}/{attempts}): {e}", flush=True)
    return None


def load_cache():
    if not os.path.exists(CACHE_CSV):
        return {}
    with open(CACHE_CSV, newline="") as f:
        return {r["biz_key"]: (r["lat"], r["lon"]) for r in csv.DictReader(f)}


def save_cache(cache):
    with open(CACHE_CSV, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["biz_key", "lat", "lon"])
        w.writerows((k, lat, lon) for k, (lat, lon) in cache.items())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--addresses", action="store_true",
                    help="look up new addresses (cached results are always applied)")
    args = ap.parse_args()

    with open(BIZ_CSV, newline="") as f:
        reader = csv.DictReader(f)
        fields = reader.fieldnames
        rows = list(reader)
    for extra in ("lat", "lon", "geo_precision", "website"):
        if extra not in fields:
            fields.append(extra)

    # Street-level (Census, interpolated along the street) for every non-individual business.
    cache = load_cache()
    eligible = [(i, r) for i, r in enumerate(rows) if r["is_individual"] != "True" and r["address"]]
    if args.addresses:
        todo = [(str(i), r["address"], r["city"], r["state"], r["zip"])
                for i, r in eligible if r["biz_key"] not in cache]
        print(f"{len(eligible):,} addresses to place, {len(eligible) - len(todo):,} already cached", flush=True)
        batches = [todo[s:s + BATCH_SIZE] for s in range(0, len(todo), BATCH_SIZE)]
        done = 0
        with ThreadPoolExecutor(WORKERS) as pool:
            for batch, result in zip(batches, pool.map(census_batch_retry, batches)):
                done += len(batch)
                if result is None:
                    continue  # leave uncached so the next run retries it
                for rid, *_ in batch:
                    lat, lon = result.get(rid, ("", ""))
                    cache[rows[int(rid)]["biz_key"]] = (lat, lon)
                print(f"geocoded {done:,}/{len(todo):,}", flush=True)
        save_cache(cache)
    exact = {}
    for i, r in eligible:
        lat, lon = cache.get(r["biz_key"], ("", ""))
        if lat != "":
            exact[str(i)] = (float(lat), float(lon))

    # Rooftop (Geocodio) where available; this puts the pin on the building itself.
    roof = rooftop.lookup([
        (r["biz_key"], r["address"], r["city"], r["state"], r["zip"], float(r.get("est_revenue_mid") or 0))
        for _, r in eligible
    ]) if args.addresses else rooftop.lookup([])

    zips = zip_centroids()

    # Building-level placement from Overture open data (address points, business places, footprints).
    placed = {}
    if os.environ.get("OVERTURE", "1") != "0" and eligible:
        state = eligible[0][1]["state"]
        try:
            placed = overture.place(state, [
                (r["biz_key"], r["name"], r["address"], r["zip"], *(
                    exact[str(i)] + (True,) if str(i) in exact else
                    zips[r["zip"]] + (False,) if r["zip"] in zips else (None, None, False)))
                for i, r in eligible
            ])
        except Exception as e:  # noqa: BLE001
            print(f"Overture placement failed, keeping street-level points: {e!r}", flush=True)

    for i, r in enumerate(rows):
        best = placed.get(r["biz_key"]) if r["is_individual"] != "True" else None
        r["website"] = best[3] if best else ""
        if best and best[2] in ("rooftop", "place"):
            r["lat"], r["lon"], r["geo_precision"] = best[:3]
        elif r["is_individual"] != "True" and r["biz_key"] in roof:
            r["lat"], r["lon"] = roof[r["biz_key"]]
            r["geo_precision"] = "rooftop"
        elif best:
            r["lat"], r["lon"], r["geo_precision"] = best[:3]
        elif str(i) in exact:
            r["lat"], r["lon"] = exact[str(i)]
            r["geo_precision"] = "address"
        elif r["zip"] in zips:
            lat, lon = zips[r["zip"]]
            dlat, dlon = jitter(r["biz_key"])
            r["lat"], r["lon"] = round(lat + dlat, 6), round(lon + dlon, 6)
            r["geo_precision"] = "zip"

    write_rows(BIZ_CSV, fields, rows)
    located = sum(1 for r in rows if r.get("lat"))
    kinds = defaultdict(int)
    for r in rows:
        kinds[r.get("geo_precision") or "none"] += 1
    print(f"Located {located:,}/{len(rows):,} businesses: {dict(kinds)}")


if __name__ == "__main__":
    main()
