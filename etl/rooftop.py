"""Rooftop-accurate coordinates from Geocodio, cached across runs.

Used by geocode.py when GEOCODIO_API_KEY is set. GEOCODIO_DAILY_LIMIT caps new
lookups per run (default 2,500, Geocodio's free daily allowance), so a daily
scheduled run fills the cache for free over time; raise it to do everything at once.
"""
import csv
import json
import os

from netutil import urlopen

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "..", "data")
CACHE_CSV = os.path.join(DATA_DIR, "rooftop_cache.csv")   # biz_key -> lat, lon, accuracy_type
API = os.environ.get("GEOCODIO_URL", "https://api.geocod.io/v1.7/geocode")
BATCH_SIZE = 1_000
# Only these put the pin on the business's own building or parcel.
ROOFTOP_TYPES = {"rooftop", "point"}


def load_cache():
    if not os.path.exists(CACHE_CSV):
        return {}
    with open(CACHE_CSV, newline="") as f:
        return {r["biz_key"]: (r["lat"], r["lon"], r["accuracy_type"]) for r in csv.DictReader(f)}


def save_cache(cache):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(CACHE_CSV, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["biz_key", "lat", "lon", "accuracy_type"])
        w.writerows((k, *v) for k, v in cache.items())


def _best(response):
    """(lat, lon, accuracy_type) of the top match in one Geocodio response, or None."""
    results = (response or {}).get("results") or []
    if not results:
        return None
    top = results[0]
    loc = top.get("location") or {}
    if loc.get("lat") is None or loc.get("lng") is None:
        return None
    return str(loc["lat"]), str(loc["lng"]), str(top.get("accuracy_type", ""))


def geocode_batch(key, addresses):
    """addresses: {id: "street, city, ST zip"} -> {id: (lat, lon, accuracy_type) or None}"""
    req_body = json.dumps(addresses).encode()
    with urlopen(f"{API}?api_key={key}", data=req_body,
                 headers={"Content-Type": "application/json"}, timeout=600) as r:
        payload = json.load(r)
    results = payload.get("results", {})
    # Keyed requests come back keyed; tolerate a list response too.
    items = results.items() if isinstance(results, dict) else zip(addresses, results)
    return {k: _best((v or {}).get("response")) for k, v in items}


def lookup(rows):
    """rows: [(biz_key, address, city, state, zip, priority)] -> {biz_key: (lat, lon)} at rooftop accuracy."""
    key = os.environ.get("GEOCODIO_API_KEY", "").strip()
    cache = load_cache()
    if key:
        limit = int(os.environ.get("GEOCODIO_DAILY_LIMIT") or 2_500)
        # Biggest businesses first, so the most-viewed listings get rooftop pins first.
        todo = sorted((r for r in rows if r[0] not in cache), key=lambda r: -r[5])[:limit]
        print(f"Geocodio: {len(rows) - sum(1 for r in rows if r[0] not in cache):,} cached, "
              f"looking up {len(todo):,} now (limit {limit:,})", flush=True)
        for start in range(0, len(todo), BATCH_SIZE):
            batch = {r[0]: f"{r[1]}, {r[2]}, {r[3]} {r[4]}" for r in todo[start:start + BATCH_SIZE]}
            try:
                found = geocode_batch(key, batch)
            except Exception as e:  # noqa: BLE001
                body = getattr(e, "read", lambda: b"")()[:300]
                print(f"Geocodio batch failed: {e} {body!r}; stopping for this run", flush=True)
                break
            for k in batch:
                cache[k] = found.get(k) or ("", "", "none")
            save_cache(cache)
            print(f"Geocodio: {min(start + BATCH_SIZE, len(todo)):,}/{len(todo):,}", flush=True)
        types = {}
        for v in cache.values():
            types[v[2]] = types.get(v[2], 0) + 1
        print(f"Geocodio accuracy types so far: {types}", flush=True)
    else:
        print("GEOCODIO_API_KEY not set; using cached rooftop results only", flush=True)
    return {k: (float(v[0]), float(v[1])) for k, v in cache.items() if v[0] and v[2] in ROOFTOP_TYPES}
