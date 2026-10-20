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
import os
import uuid
import zipfile

from netutil import urlopen

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "..", "data")
BIZ_CSV = os.path.join(DATA_DIR, "businesses.csv")
GAZ_URL = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_zcta_national.zip"
GAZ_TXT = os.path.join(DATA_DIR, "zcta_gazetteer.txt")
BATCH_URL = "https://geocoding.geo.census.gov/geocoder/locations/addressbatch"
BATCH_SIZE = 10_000


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


def jitter(key, scale=0.012):
    """Deterministic offset so businesses in one ZIP don't stack on a single pin."""
    h = hashlib.md5(key.encode()).digest()
    return (h[0] / 255 - 0.5) * scale, (h[1] / 255 - 0.5) * scale


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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--addresses", action="store_true", help="street-level Census geocoding")
    args = ap.parse_args()

    with open(BIZ_CSV, newline="") as f:
        reader = csv.DictReader(f)
        fields = reader.fieldnames
        rows = list(reader)
    for extra in ("lat", "lon", "geo_precision"):
        if extra not in fields:
            fields.append(extra)

    exact = {}
    if args.addresses:
        todo = [(str(i), r["address"], r["city"], r["state"], r["zip"])
                for i, r in enumerate(rows) if r["is_individual"] != "True" and r["address"]]
        for start in range(0, len(todo), BATCH_SIZE):
            exact.update(census_batch(todo[start:start + BATCH_SIZE]))
            print(f"geocoded {min(start + BATCH_SIZE, len(todo)):,}/{len(todo):,} "
                  f"({len(exact):,} matched)", flush=True)

    zips = zip_centroids()
    for i, r in enumerate(rows):
        if str(i) in exact:
            r["lat"], r["lon"] = exact[str(i)]
            r["geo_precision"] = "address"
        elif r["zip"] in zips:
            lat, lon = zips[r["zip"]]
            dlat, dlon = jitter(r["biz_key"])
            r["lat"], r["lon"] = round(lat + dlat, 6), round(lon + dlon, 6)
            r["geo_precision"] = "zip"

    with open(BIZ_CSV, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)
    located = sum(1 for r in rows if r.get("lat"))
    print(f"Located {located:,}/{len(rows):,} businesses ({len(exact):,} street-level)")


if __name__ == "__main__":
    main()
