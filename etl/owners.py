"""Find owner / founder names on business websites (free, pattern-based).

    python etl/owners.py

For each listed business with a website, reads the homepage and up to MAX_EXTRA_PAGES linked
About/Team/Leadership pages, then looks for schema.org founder data and phrases such as
"Owner: Jane Smith", "Jane Smith, Owner", "founded by Jane Smith". Respects robots.txt.
Results (including misses) are cached per website in data/owners_cache.csv and rechecked
after RECHECK_DAYS, so daily runs only visit new sites. Adds owner_name, owner_title and
owner_source columns to data/businesses.csv.

The same pages (plus a Contact page) give the contact details the business publishes about itself:
site_phone (tel: links first), site_email (up to three addresses, its own domain first; web
designers' and platform addresses are dropped) and contact_page.
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
from csvio import write_rows

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "..", "data")
BIZ_CSV = os.path.join(DATA_DIR, "businesses.csv")
CACHE_CSV = os.path.join(DATA_DIR, "owners_cache.csv")
LISTED = {"rooftop", "place", "building", "address"}
WORKERS = 64
TIME_BUDGET_MIN = int(os.environ.get("OWNERS_SCAN_MINUTES") or 45)   # rest continues next run
CHUNK = 2_000
TIMEOUT = 10
MAX_BYTES = 1_000_000
MAX_EXTRA_PAGES = 3
RECHECK_DAYS = 90
SOCIAL = ("facebook.com", "instagram.com", "twitter.com", "x.com", "linkedin.com", "yelp.com", "tiktok.com")
CONTACT_LINK = re.compile(r"contact|reach-us|get-in-touch|locations?\b", re.I)
CONTACTS_VERSION = "1"     # cached sites scanned before contacts were collected are rescanned
MAX_EMAILS = 3
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
PHONE_RE = re.compile(r"(?<![\d-])(?:\+?1[\s.\-]?)?\(?([2-9]\d{2})\)?[\s.\-]?([2-9]\d{2})[\s.\-]?(\d{4})(?![\d-])")
FREE_MAIL = ("gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "aol.com", "icloud.com", "sbcglobal.net",
             "att.net", "cox.net", "live.com", "msn.com", "me.com", "windstream.net", "swbell.net")
# Addresses on pages that aren't the business's own (site builders, error trackers, placeholders).
JUNK_MAIL = ("example.", "domain.com", "yourdomain", "email.com", "sentry", "wixpress", "wix.com", "godaddy",
             "squarespace", "wordpress", "schema.org", "w3.org", "mysite", "yoursite", "company.com", "test.com")
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
    # job titles and organisation words that otherwise pass as "First Last"
    "Co", "Corp", "Executive", "Director", "Chief", "Officer", "Vice", "Partner", "Partners", "Board", "Member",
    "Members", "Meeting", "Staff", "Nurse", "Practitioner", "Doctor", "Agent", "Agency", "Insurance", "Store",
    "Center", "Health", "Care", "Electric", "Operator", "Operators", "Independent", "Associate", "Assistant",
    "Administrator", "Coordinator", "Supervisor", "Chairman", "Chair", "Secretary", "Treasurer", "Committee",
    "Association", "Foundation", "Church", "School", "University", "Department", "State", "County", "National",
}


def _text(raw):
    raw = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", raw)
    raw = re.sub(r"(?s)<[^>]+>", "\n", raw)
    return re.sub(r"[ \t\r\f\v]+", " ", html.unescape(raw))


def _fetch(url, html_only=True):
    try:
        with urlopen(url, timeout=TIMEOUT) as r:
            if html_only and "html" not in (r.headers.get("Content-Type") or "html"):
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
    raw, _ = _fetch(urllib.parse.urljoin(site, "/robots.txt"), html_only=False)
    if raw is None:
        return None
    rp.parse(raw.splitlines())
    return rp


def _valid_name(name, business_name):
    words = name.replace(",", " ").split()
    # At least two parts, one of them a full word ("B. L. Moore" is fine, "James" isn't).
    if (len(words) < 2 or not any(len(w.strip(".")) > 1 for w in words)
            or any(w.strip(".") in NOT_NAMES for w in words)):
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


def collect_pages(site):
    """[(url, html)] for the homepage and up to MAX_EXTRA_PAGES About/Team pages, honouring robots.txt."""
    robots = _robots(site)
    if not _allowed(robots, site):
        return []
    raw, final = _fetch(site)
    if raw is None:
        return []
    pages = [(final, raw)]
    host = urllib.parse.urlparse(final).netloc
    links = []
    for href in re.findall(r'(?i)<a[^>]+href=["\']([^"\'#]+)', raw):
        try:
            url = urllib.parse.urljoin(final, href)
            same_host = urllib.parse.urlparse(url).netloc == host
        except ValueError:   # malformed link, e.g. href="http://[$vHost_Rails]/"
            continue
        if same_host and ABOUT_LINK.search(href) and url not in links:
            links.append(url)
    contact = next((urllib.parse.urljoin(final, h) for h in re.findall(r'(?i)<a[^>]+href=["\']([^"\'#]+)', raw)
                    if CONTACT_LINK.search(h) and not h.lower().startswith(("mailto:", "tel:"))), None)
    try:
        if contact and urllib.parse.urlparse(contact).netloc == host and contact not in links[:MAX_EXTRA_PAGES]:
            links = links[:MAX_EXTRA_PAGES] + [contact]
    except ValueError:
        pass
    for url in links[:MAX_EXTRA_PAGES + 1]:
        if _allowed(robots, url):
            page, page_url = _fetch(url)
            if page:
                pages.append((page_url, page))
    return pages


def _host(url):
    host = (urllib.parse.urlparse(url).netloc or "").lower().split(":")[0]
    return host[4:] if host.startswith("www.") else host


def _base(domain):
    """'mail.acme-co.com' -> 'acme-co.com' (good enough for .com/.net/.org/.us sites)."""
    return ".".join(domain.split(".")[-2:])


def format_phone(number):
    digits = re.sub(r"\D", "", number or "")
    if len(digits) == 11 and digits[0] == "1":
        digits = digits[1:]
    if len(digits) != 10 or digits[0] in "01" or digits[3] in "01" or digits[3:6] == "555":
        return None
    return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"


def contacts(pages):
    """(phone, [emails], page_url) the business publishes on its own site."""
    if not pages:
        return None, [], ""
    own = _base(_host(pages[0][0]))
    phone = phone_page = None
    emails = {}   # address -> (rank, page)
    for url, raw in pages:
        hrefs = re.findall(r'(?i)href=["\'](?:mailto|tel):([^"\'?]+)', raw)
        text = _text(raw)
        found = [urllib.parse.unquote(h).strip() for h in hrefs] + EMAIL_RE.findall(text)
        for e in found:
            e = e.lower().strip(".")
            if not EMAIL_RE.fullmatch(e) or any(j in e for j in JUNK_MAIL) or e.endswith((".png", ".jpg", ".gif", ".webp", ".svg")):
                continue
            domain = e.split("@")[1]
            # Its own domain, or a free mailbox it lists; another company's domain is usually the web designer.
            rank = 0 if _base(domain) == own else 1 if domain in FREE_MAIL else None
            if rank is not None and (e not in emails or rank < emails[e][0]):
                emails[e] = (rank, url)
        if phone is None:
            tel = [format_phone(h) for h in hrefs if not EMAIL_RE.fullmatch(h.strip())]
            text_phones = [format_phone("".join(m)) for m in PHONE_RE.findall(text)]
            hit = next((p for p in tel + text_phones if p), None)
            if hit:
                phone, phone_page = hit, url
    best = sorted(emails, key=lambda e: emails[e][0])[:MAX_EMAILS]
    page = phone_page or (emails[best[0]][1] if best else "")
    return phone, best, page


def scan(site, business_name):
    """(best (name, title, source_url) or None, (phone, emails, page)) for a business website
    (empty on any error, so one malformed site can't stop the scan)."""
    try:
        return _scan(site, business_name)
    except Exception as e:  # noqa: BLE001
        print(f"Owners: skipped {site}: {e!r}", flush=True)
        return None, (None, [], "")


def _scan(site, business_name):
    best = None
    pages = collect_pages(site)
    for url, page in pages:
        hit = extract(page, business_name)
        if hit and (best is None or _title_rank(hit[1]) < _title_rank(best[1])):
            best = (*hit, url)
    return best, contacts(pages)


CACHE_FIELDS = ["website", "owner_name", "owner_title", "owner_source", "checked",
                "site_phone", "site_email", "contact_page", "contacts_version"]


def load_cache():
    if not os.path.exists(CACHE_CSV):
        return {}
    with open(CACHE_CSV, newline="") as f:
        return {r["website"]: r for r in csv.DictReader(f)}


def save_cache(cache):
    with open(CACHE_CSV, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=CACHE_FIELDS)
        w.writeheader()
        w.writerows(cache.values())


def main():
    with open(BIZ_CSV, newline="") as f:
        reader = csv.DictReader(f)
        fields = reader.fieldnames
        rows = list(reader)
    for extra in ("owner_name", "owner_title", "owner_source", "site_phone", "site_email", "contact_page"):
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
    todo = [(s, n) for s, n in sites.items() if s not in cache or float(cache[s]["checked"] or 0) < cutoff
            or cache[s].get("contacts_version") != CONTACTS_VERSION]
    print(f"Owners: {len(sites):,} websites, {len(todo):,} to scan", flush=True)

    deadline = time.time() + TIME_BUDGET_MIN * 60
    with ThreadPoolExecutor(WORKERS) as pool:
        for start in range(0, len(todo), CHUNK):
            if time.time() > deadline:
                print(f"Owners: time budget used; {len(todo) - start:,} sites left for the next run", flush=True)
                break
            chunk = todo[start:start + CHUNK]
            for (site, _), (owner, (phone, emails, page)) in zip(chunk, pool.map(lambda t: scan(*t), chunk)):
                name, title, source = owner or ("", "", "")
                cache[site] = {"website": site, "owner_name": name, "owner_title": title,
                               "owner_source": source, "checked": f"{time.time():.0f}",
                               "site_phone": phone or "", "site_email": "; ".join(emails), "contact_page": page,
                               "contacts_version": CONTACTS_VERSION}
            save_cache(cache)
            print(f"Owners: scanned {start + len(chunk):,}/{len(todo):,}", flush=True)

    found = 0
    for r in rows:
        hit = cache.get((r.get("website") or "").strip())
        # Re-validated on every run, so tightening the rules also cleans up cached results.
        good = hit and hit["owner_name"] and _valid_name(hit["owner_name"], r["name"])
        r["owner_name"], r["owner_title"], r["owner_source"] = (
            (hit["owner_name"], hit["owner_title"], hit["owner_source"]) if good else ("", "", ""))
        found += bool(r["owner_name"])
        r["site_phone"], r["site_email"], r["contact_page"] = (
            (hit.get("site_phone") or "", hit.get("site_email") or "", hit.get("contact_page") or "") if hit else ("", "", ""))
    write_rows(BIZ_CSV, fields, rows)
    with_phone = sum(bool(r["site_phone"]) for r in rows)
    with_email = sum(bool(r["site_email"]) for r in rows)
    print(f"Owners: website contacts: {with_phone:,} phones, {with_email:,} with email", flush=True)
    print(f"Owners: found a name for {found:,} businesses ({found / max(len(sites), 1):.0%} of scanned websites)",
          flush=True)
    # A fixed sample in the log, so results can be spot-checked without database access.
    hits = sorted((r for r in rows if r["owner_name"]), key=lambda r: r["biz_key"])
    for r in hits[:: max(1, len(hits) // 20)][:20]:
        print(f"  sample: {r['name']} ({r['city']}) -> {r['owner_title']}: {r['owner_name']} | {r['owner_source']}",
              flush=True)


if __name__ == "__main__":
    main()
