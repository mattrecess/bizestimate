"""Years in business: the earliest year a public record shows the business existed.

    DATABASE_URL=... python etl/founded.py --state OK

Evidence, all lower bounds on age: FDIC "established" date, DOT registration, an SBA loan to a
startup ("loan funds will open business"), and when the business's website domain was registered
(RDAP, the public successor to WHOIS). The earliest wins. Domain lookups are cached and capped per
run, so the first few runs fill in gradually.
"""
import argparse
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

import psycopg

import enrich
from load import database_url
from netutil import urlopen

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "..", "data", "cache", "rdap_cache.json")
# The registries' own RDAP servers (the rdap.org relay rate-limits hard); others via the relay.
RDAP = {
    "com": "https://rdap.verisign.com/com/v1/domain/{domain}",
    "net": "https://rdap.verisign.com/net/v1/domain/{domain}",
    "org": "https://rdap.publicinterestregistry.org/rdap/domain/{domain}",
}
RDAP_OTHER = "https://rdap.org/domain/{domain}"
MAX_LOOKUPS = int(os.environ.get("RDAP_MAX_LOOKUPS", "4000"))
WORKERS = 2
PAUSE = 0.3   # seconds between a worker's requests
errors = {}
EARLIEST = 1900


def domain_of(url):
    host = urlparse(url if "//" in url else "http://" + url).hostname or ""
    host = host.lower().removeprefix("www.")
    parts = host.split(".")
    return ".".join(parts[-2:]) if len(parts) >= 2 else None


def registered_year(domain):
    url = RDAP.get(domain.rsplit(".", 1)[-1], RDAP_OTHER).format(domain=domain)
    time.sleep(PAUSE)
    try:
        with urlopen(url, headers={"Accept": "application/rdap+json"}, timeout=30) as r:
            data = json.loads(r.read())
        for ev in data.get("events", []):
            if ev.get("eventAction") == "registration" and ev.get("eventDate", "")[:4].isdigit():
                return int(ev["eventDate"][:4])
    except Exception as e:  # noqa: BLE001  (unknown TLD, rate limit, not found)
        kind = getattr(e, "code", None) or type(e).__name__
        errors[kind] = errors.get(kind, 0) + 1
        return 0 if kind == 404 else None   # 404: domain no longer registered; don't ask again
    return 0   # answered, but no registration date


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", default="OK")
    state = ap.parse_args().state.upper()
    cache = {}
    if os.path.exists(CACHE):
        with open(CACHE) as f:
            cache = json.load(f)
    with psycopg.connect(database_url()) as conn, conn.cursor() as cur:
        cur.execute("select biz_key, website from businesses where state = %s and coalesce(website, '') <> ''", (state,))
        sites = {k: domain_of(w) for k, w in cur.fetchall()}
        todo = sorted({d for d in sites.values() if d and d not in cache})[:MAX_LOOKUPS]
        t = time.time()
        with ThreadPoolExecutor(WORKERS) as pool:
            for d, year in zip(todo, pool.map(registered_year, todo)):
                if year is not None:
                    cache[d] = year
        os.makedirs(os.path.dirname(CACHE), exist_ok=True)
        with open(CACHE + ".tmp", "w") as f:
            json.dump(cache, f)
        os.replace(CACHE + ".tmp", CACHE)
        print(f"founded: lookup errors {errors}", flush=True)
        print(f"founded: looked up {len(todo):,} domains in {time.time() - t:,.0f}s; "
              f"{sum(1 for v in cache.values() if v):,} with a registration year cached", flush=True)

        cur.execute("""select biz_key, source, data from business_sources
                       where source in ('fdic', 'fmcsa', 'sba') and biz_key in
                         (select biz_key from businesses where state = %s)""", (state,))
        evidence = {}
        for key, source, data in cur.fetchall():
            ev = evidence.setdefault(key, {})
            if source == "fdic" and data.get("founded"):
                ev["FDIC charter"] = data["founded"]
            elif source == "fmcsa" and data.get("registered"):
                ev["DOT registration"] = data["registered"]
            elif source == "sba":
                starts = [l["fiscal_year"] for l in data.get("loans", []) if "startup" in (l.get("business_age") or "").lower()]
                if starts:
                    ev["SBA startup loan"] = min(starts)
        for key, d in sites.items():
            if d and cache.get(d):
                evidence.setdefault(key, {})["Website registered"] = cache[d]
        this_year = time.gmtime().tm_year
        rows = {}
        for key, ev in evidence.items():
            ev = {k: v for k, v in ev.items() if EARLIEST <= v <= this_year}
            if ev:
                basis = min(ev, key=ev.get)
                rows[key] = {"year": ev[basis], "basis": basis, "evidence": ev}
        enrich.save(cur, state, "founded", rows)


if __name__ == "__main__":
    main()
