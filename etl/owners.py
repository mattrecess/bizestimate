"""Find owner / founder names on business websites (free, pattern-based).

    python etl/owners.py

For each listed business with a website, reads the homepage and up to MAX_EXTRA_PAGES linked
About/Team/Leadership pages, then looks for schema.org founder data and phrases such as
"Owner: Jane Smith", "Jane Smith, Owner", "founded by Jane Smith". Respects robots.txt.
Results (including misses) are cached per website in data/owners_cache.csv and rechecked
after RECHECK_DAYS, so daily runs only visit new sites. Adds owner_name, owner_title and
owner_source columns to data/businesses.csv.
"""
import csv
import html
import json
import os
import re
import time
import urllib.parse
import urllib.robotparser
from concurrent.futures import ThreadPoolExecutor

from netutil import HEADERS, urlopen

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "..", "data")
BIZ_CSV = os.path.join(DATA_DIR, "businesses.csv")
CACHE_CSV = os.path.join(DATA_DIR, "owners_cache.csv")
LISTED = {"rooftop", "place", "building", "address"}
WORKERS = 32
TIMEOUT = 10
MAX_BYTES = 1_000_000
MAX_EXTRA_PAGES = 3
RECHECK_DAYS = 90
SOCIAL = ("facebook.com", "instagram.com", "twitter.com", "x.com", "linkedin.com", "yelp.com", "tiktok.com")
ABOUT_LINK = re.compile(r"about|team|our-story|story|leadership|staff|who-we-are|meet|people|owner|history", re.I)

# Titles we accept, strongest first.
TITLES = ["Owner", "Co-Owner", "Founder", "Co-Founder", "President", "CEO", "Principal", "Managing Partner"]
TITLE_RE = r"(Owner|Co-Owner|Founder|Co-Founder|President|CEO|Chief Executive Officer|Principal|Managing Partner)"
NAME = r"([A-Z][a-z]+(?:\s[A-Z]\.)?(?:\s(?:Mc|Mac|O')?[A-Z][a-z'\-]+){1,2})"
# (pattern, kind): "title_name" captures (title, name), "name_title" (name, title),
# "founded"/"owned" capture just the name.
PATTERNS = [
    (re.compile(rf"\b{TITLE_RE}\s*(?:and\s+\w+\s*)?[:\-–—]\s*{NAME}"), "title_name"),        # Owner: Jane Smith
    (re.compile(rf"{NAME}\s*[,\-–—|]\s*(?:the\s+)?{TITLE_RE}\b"), "name_title"),              # Jane Smith, Owner
    (re.compile(rf"{NAME}\s+(?:is|was)\s+the\s+(?:proud\s+)?{TITLE_RE}\b"), "name_title"),    # Jane Smith is the owner
    (re.compile(rf"\b(?:founded|started|established)\s+(?:in\s+\d{{4}}\s+)?by\s+{NAME}"), "founded"),
    (re.compile(rf"\bowned\s+(?:and\s+operated\s+)?by\s+{NAME}"), "owned"),
]
# Capitalised words that look like names but aren't.
NOT_NAMES = {
    "Our", "The", "Meet", "About", "Read", "More", "Contact", "Home", "Team", "Learn", "View", "Click", "Call",
    "Oklahoma", "City", "Tulsa", "Edmond", "Norman", "Company", "Services", "Group", "Inc", "Llc", "Family",
    "Business", "Customer", "Service", "Owner", "Founder", "President", "General", "Manager", "Office", "Sales",
    "Welcome", "Thank", "Since", "Today", "Here", "This", "That", "With", "Your", "Free", "Best", "New",
}


def _text(raw):
    raw = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", raw)
    raw = re.sub(r"(?s)<[^>]+>", "\n", raw)
    return re.sub(r"[ \t\r\f\v]+", " ", html.unescape(raw))


def _fetch(url):
    try:
        with urlopen(url, timeout=TIMEOUT) as r:
            if "html" not in (r.headers.get("Content-Type") or "html"):
                return None, url
            return r.read(MAX_BYTES).decode("utf-8", errors="replace"), r.geturl()
    except Exception:  # noqa: BLE001 - unreachable sites are simply a miss
        return None, url


def _allowed(robots, url):
    try:
        return robots is None or robots.can_fetch(HEADERS["User-Agent"], url)
    except Exception:  # noqa: BLE001
        return True


def _robots(site):
    rp = urllib.robotparser.RobotFileParser()
    raw, _ = _fetch(urllib.parse.urljoin(site, "/robots.txt"))
    if raw is None:
        return None
    rp.parse(raw.splitlines())
    return rp


def _valid_name(name, business_name):
    words = name.split()
    if len(words) < 2 or any(w.strip(".") in NOT_NAMES for w in words):
        return False
    biz_words = set(re.findall(r"[A-Z]+", (business_name or "").upper()))
    # "Smith Plumbing" names the company, not a person; allow a shared surname only.
    return sum(w.upper() in biz_words for w in words) < len(words)


def _title_rank(title):
    title = "CEO" if title.lower().startswith("chief executive") else title
    return TITLES.index(title) if title in TITLES else len(TITLES)


def extract(raw, business_name):
    """(name, title) found in one HTML page, or None."""
    found = []
    # schema.org JSON-LD: {"founder": {"name": "..."}}
    for block in re.findall(r'(?is)<script[^>]+application/ld\+json[^>]*>(.*?)</script>', raw):
        try:
            data = json.loads(block)
        except ValueError:
            continue
        for item in data if isinstance(data, list) else [data]:
            founders = item.get("founder") if isinstance(item, dict) else None
            for f in founders if isinstance(founders, list) else [founders]:
                name = f.get("name") if isinstance(f, dict) else f
                if isinstance(name, str) and _valid_name(name.strip(), business_name):
                    found.append((name.strip(), "Founder"))
    text = _text(raw)
    for pattern, kind in PATTERNS:
        for m in pattern.finditer(text):
            if kind == "title_name":
                title, name = m.groups()
            elif kind == "name_title":
                name, title = m.groups()
            else:
                name, title = m.group(1), "Founder" if kind == "founded" else "Owner"
            if _valid_name(name, business_name):
                found.append((name, "CEO" if title.lower().startswith("chief") else title))
    return min(found, key=lambda f: _title_rank(f[1])) if found else None


def scan(site, business_name):
    """Best (name, title, source_url) on a business website, or None."""
    robots = _robots(site)
    if not _allowed(robots, site):
        return None
    raw, final = _fetch(site)
    if raw is None:
        return None
    best = None
    hit = extract(raw, business_name)
    if hit:
        best = (*hit, final)
    host = urllib.parse.urlparse(final).netloc
    links = []
    for href in re.findall(r'(?i)<a[^>]+href=["\']([^"\'#]+)', raw):
        url = urllib.parse.urljoin(final, href)
        if urllib.parse.urlparse(url).netloc == host and ABOUT_LINK.search(href) and url not in links:
            links.append(url)
    for url in links[:MAX_EXTRA_PAGES]:
        if best and _title_rank(best[1]) == 0:
            break
        if not _allowed(robots, url):
            continue
        page, page_url = _fetch(url)
        hit = extract(page, business_name) if page else None
        if hit and (best is None or _title_rank(hit[1]) < _title_rank(best[1])):
            best = (*hit, page_url)
    return best


def load_cache():
    if not os.path.exists(CACHE_CSV):
        return {}
    with open(CACHE_CSV, newline="") as f:
        return {r["website"]: r for r in csv.DictReader(f)}


def save_cache(cache):
    with open(CACHE_CSV, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["website", "owner_name", "owner_title", "owner_source", "checked"])
        w.writeheader()
        w.writerows(cache.values())


def main():
    with open(BIZ_CSV, newline="") as f:
        reader = csv.DictReader(f)
        fields = reader.fieldnames
        rows = list(reader)
    for extra in ("owner_name", "owner_title", "owner_source"):
        if extra not in fields:
            fields.append(extra)

    cache = load_cache()
    cutoff = time.time() - RECHECK_DAYS * 86400
    sites = {}
    for r in rows:
        site = (r.get("website") or "").strip()
        if (site and r.get("geo_precision") in LISTED and r.get("is_individual") != "True"
                and not any(d in site.lower() for d in SOCIAL)):
            sites.setdefault(site, r["name"])
    todo = [(s, n) for s, n in sites.items() if s not in cache or float(cache[s]["checked"] or 0) < cutoff]
    print(f"Owners: {len(sites):,} websites, {len(todo):,} to scan", flush=True)

    with ThreadPoolExecutor(WORKERS) as pool:
        for done, ((site, _), result) in enumerate(zip(todo, pool.map(lambda t: scan(*t), todo)), 1):
            name, title, source = result or ("", "", "")
            cache[site] = {"website": site, "owner_name": name, "owner_title": title,
                           "owner_source": source, "checked": f"{time.time():.0f}"}
            if done % 1000 == 0:
                save_cache(cache)
                print(f"Owners: scanned {done:,}/{len(todo):,}", flush=True)
    save_cache(cache)

    found = 0
    for r in rows:
        hit = cache.get((r.get("website") or "").strip())
        r["owner_name"], r["owner_title"], r["owner_source"] = (
            (hit["owner_name"], hit["owner_title"], hit["owner_source"]) if hit and hit["owner_name"] else ("", "", ""))
        found += bool(r["owner_name"])
    with open(BIZ_CSV, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)
    print(f"Owners: found a name for {found:,} businesses ({found / max(len(sites), 1):.0%} of scanned websites)",
          flush=True)


if __name__ == "__main__":
    main()
