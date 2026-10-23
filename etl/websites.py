"""Drop websites that don't plausibly belong to their business.

    python etl/websites.py

Websites come from name-matching Overture places, which occasionally attaches a similarly named
organisation's site (e.g. a university for "Miami Women's Clinic" in Miami, OK). A website is kept if
  - its domain contains the business's first distinctive word (unless that word is just the city),
    its first two words together, or the initials of its name (gpcok.com for Great Plains
    Construction), and it isn't a .edu/.gov site; or
  - its homepage shows the business's first two name words as a phrase ("Fairview Farm"), and also
    mentions Oklahoma / OK / the business's city.
Otherwise the website is cleared, so neither it nor an owner found on it is shown. Homepage
title and text are cached per website in data/website_check_cache.json.
"""
import json
import os
import re
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

from matching import ordered_name_tokens
from owners import BIZ_CSV, LISTED, RECHECK_DAYS, _allowed, _fetch, _robots, _text

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "..", "data")
CACHE_JSON = os.path.join(DATA_DIR, "website_check_cache.json")
WORKERS = 64
TIME_BUDGET_MIN = int(os.environ.get("WEBSITE_CHECK_MINUTES") or 60)   # rest continues next run
CHUNK = 2_000
TEXT_CHARS = 6_000
# Words too common to identify a business on their own.
GENERIC = {
    "SERVICES", "SERVICE", "GROUP", "HOLDINGS", "ENTERPRISES", "SOLUTIONS", "INDUSTRIES", "INTERNATIONAL",
    "AMERICAN", "AMERICA", "NATIONAL", "UNITED", "CENTER", "ASSOCIATES", "SYSTEMS", "MANAGEMENT", "PROPERTIES",
    "CONSTRUCTION", "CONSULTING", "HOME", "HEALTH", "CARE", "FAMILY", "FIRST", "1ST", "ALL", "PRO", "BEST",
}


def _words(text):
    return set(re.sub(r"[^A-Z0-9 ]", " ", text.upper()).split())


def domain_label(url):
    host = urllib.parse.urlparse(url).netloc.lower().split(":")[0]
    host = re.sub(r"^www\d?\.", "", host)
    parts = host.split(".")
    return re.sub(r"[^a-z0-9]", "", parts[-2] if len(parts) >= 2 else parts[0])


DIRECTIONS = {"NORTH": "N", "SOUTH": "S", "EAST": "E", "WEST": "W", "NORTHEAST": "NE", "NORTHWEST": "NW",
              "SOUTHEAST": "SE", "SOUTHWEST": "SW"}
LEGAL = {"LLC", "INC", "INCORPORATED", "CORP", "CORPORATION", "CO", "COMPANY", "LTD", "PLLC", "PC", "LP", "LLP",
         "PA", "DBA", "THE", "OF", "AND", "IC"}
EDU_NAMES = {"UNIVERSITY", "COLLEGE", "SCHOOL", "ACADEMY", "SCHOOLS"}
GOV_NAMES = {"NATION", "TRIBE", "TRIBAL", "CITY", "TOWN", "COUNTY", "AUTHORITY", "DISTRICT", "MUNICIPAL"}


def _variants(token):
    """Spellings a word may take in a domain: BRADYS -> BRADY, SOUTHWEST -> SW."""
    out = {token}
    if token.endswith("S") and len(token) > 4:
        out.add(token[:-1])
    if token in DIRECTIONS:
        out.add(DIRECTIONS[token])
    return {v.lower() for v in out}


def domain_matches(name, url, city=""):
    tokens = ordered_name_tokens(name)
    host = urllib.parse.urlparse(url).netloc.lower()
    label = domain_label(url)
    words = _words(name)
    if not tokens or not label:
        return False
    if host.endswith(".edu") and not words & EDU_NAMES:
        return False
    if host.endswith(".gov") and not words & GOV_NAMES:
        return False
    # Initials, counting state words too ("Northeast Oklahoma Electric Cooperative" -> noec.coop).
    raw = [w for w in re.sub(r"[^A-Z0-9 ]", " ", name.upper().replace("'", "")).split() if w not in LEGAL]
    initials = "".join(w[0] for w in raw).lower()
    if len(initials) >= 3 and label.startswith(initials):
        return True
    if len(tokens) >= 2 and any(a + b in label for a in _variants(tokens[0]) for b in _variants(tokens[1])):
        return True
    first = tokens[0]
    if len(tokens) == 1 and len(first) >= 3 and label.startswith(first.lower()):
        return True   # short one-word names: "HAC" -> hacretail.com
    # A lone first word counts only if it's distinctive: not generic, not the city ("Miami ..." on miami.edu).
    return (first not in GENERIC and first not in _words(city or "") and len(first) >= 4
            and any(v in label for v in _variants(first)))


def content_matches(name, city, page):
    tokens = ordered_name_tokens(name)
    if not tokens:
        return False
    text = " " + " ".join(re.sub(r"[^A-Z0-9 ]", " ", page.upper().replace("'", "")).split()) + " "
    phrase = " " + " ".join(tokens[:2]) + " "
    local = {"OKLAHOMA", "OK"} | _words(city or "")
    return phrase in text and bool(local & set(text.split()))


def homepage(site):
    """{'title', 'text'} of a site's homepage (robots.txt respected), or None if unreadable."""
    if not _allowed(_robots(site), site):
        return None
    raw, _ = _fetch(site)
    if raw is None:
        return None
    title = re.search(r"(?is)<title[^>]*>(.*?)</title>", raw)
    return {"title": _text(title.group(1)).strip() if title else "", "text": _text(raw)[:TEXT_CHARS]}


def main():
    import csv
    with open(BIZ_CSV, newline="") as f:
        reader = csv.DictReader(f)
        fields = reader.fieldnames
        rows = list(reader)

    cache = {}
    if os.path.exists(CACHE_JSON):
        with open(CACHE_JSON) as f:
            cache = json.load(f)
    cutoff = time.time() - RECHECK_DAYS * 86400
    listed = [r for r in rows if r.get("website") and r.get("geo_precision") in LISTED and r.get("is_individual") != "True"]
    # Only sites whose domain doesn't already vouch for the business need their homepage read.
    todo = sorted({r["website"] for r in listed if not domain_matches(r["name"], r["website"], r.get("city"))
                   and (r["website"] not in cache or cache[r["website"]]["checked"] < cutoff)})
    print(f"Websites: {len(listed):,} to verify, reading {len(todo):,} homepages", flush=True)
    deadline = time.time() + TIME_BUDGET_MIN * 60
    with ThreadPoolExecutor(WORKERS) as pool:
        for start in range(0, len(todo), CHUNK):
            if time.time() > deadline:
                print(f"Websites: time budget used; {len(todo) - start:,} homepages left for the next run "
                      f"(those sites stay hidden until checked)", flush=True)
                break
            chunk = todo[start:start + CHUNK]
            for site, page in zip(chunk, pool.map(homepage, chunk)):
                cache[site] = {"page": page, "checked": time.time()}
            with open(CACHE_JSON, "w") as f:
                json.dump(cache, f)

    kept_domain = kept_content = dropped = 0
    dropped_samples = []
    for r in listed:
        if domain_matches(r["name"], r["website"], r.get("city")):
            kept_domain += 1
            continue
        page = (cache.get(r["website"]) or {}).get("page")
        if page and content_matches(r["name"], r.get("city"), f"{page['title']} {page['text']}"):
            kept_content += 1
            continue
        dropped += 1
        if len(dropped_samples) < 15:
            dropped_samples.append(f"{r['name']} ({r['city']}) x {r['website']}")
        r["website"] = ""
    with open(BIZ_CSV, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)
    print(f"Websites: kept {kept_domain:,} by domain, {kept_content:,} by homepage; dropped {dropped:,}", flush=True)
    for s in dropped_samples:
        print(f"  dropped: {s}", flush=True)


if __name__ == "__main__":
    main()
