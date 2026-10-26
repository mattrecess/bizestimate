"""LinkedIn links and company size, found through Google (Serper.dev); LinkedIn itself is never visited.

    DATABASE_URL=... SERPER_API_KEY=... python etl/linkedin.py --state OK

Largest businesses first. Per business:
  - company: `"<name>" <city> site:linkedin.com/company` -> the company page whose title is this
    business, and the size LinkedIn shows in Google's preview ("Company size: 51-200 employees").
  - owner (when we know one): `"<owner>" "<name>" site:linkedin.com/in` -> the profile whose title is
    that person and mentions the business.
Only the link and the size range are kept; nothing else from LinkedIn is copied. Results, misses
included, are kept in the database (etl_state), so each business is searched once.
LINKEDIN_MAX_TOTAL caps businesses ever searched (default 2,500, about $5 of Serper searches).
"""
import argparse
import json
import os
import re
import urllib.error
from concurrent.futures import ThreadPoolExecutor

import psycopg

import enrich
from load import database_url
from matching import name_score, name_tokens
from netutil import urlopen

SERPER = "https://google.serper.dev/search"
SEARCH_PRICE = 1 / 1000
STATE_KEY = "linkedin_cache"
MIN_NAME_SCORE = 0.8
SIZE_RE = re.compile(r"(\d[\d,]*)\s*(?:-|–|to)\s*(\d[\d,]*)\s+employees|(\d[\d,]*)\+\s+employees", re.I)
SUFFIX = re.compile(r",?\s+(LLC|L\.L\.C\.|INC\.?|CORP\.?|CORPORATION|CO\.?|COMPANY|PLLC|LTD\.?|LP|LLP)$", re.I)


def google(key, query):
    req = json.dumps({"q": query, "gl": "us", "num": 10}).encode()
    try:
        with urlopen(SERPER, data=req, headers={"X-API-KEY": key, "Content-Type": "application/json"}, timeout=30) as r:
            return json.loads(r.read()).get("organic") or []
    except urllib.error.HTTPError as e:   # Serper explains refusals (e.g. out of credits) in the body
        raise RuntimeError(f"HTTP {e.code}: {e.read()[:200].decode('utf-8', 'replace')}") from None


def short_name(name):
    return SUFFIX.sub("", (name or "").strip()).strip(" ,")


def size_range(text):
    """'Company size: 51-200 employees' -> (51, 200); '10,001+ employees' -> (10001, None)."""
    m = SIZE_RE.search(text or "")
    if not m:
        return None
    if m.group(3):
        return int(m.group(3).replace(",", "")), None
    return int(m.group(1).replace(",", "")), int(m.group(2).replace(",", ""))


def page_title(r):
    """'Hunter Mechanical & Controls | LinkedIn' -> 'Hunter Mechanical & Controls'."""
    return re.split(r"\s+[|\-–]\s+LinkedIn", r.get("title") or "")[0].strip()


def find_company(results, biz):
    tokens = name_tokens(biz["name"])
    local = {w for w in re.findall(r"[A-Z]+", (biz["city"] or "").upper())} | {"OKLAHOMA", "OK"}
    for r in results:
        url = r.get("link") or ""
        if "linkedin.com/company/" not in url:
            continue
        text = f"{r.get('title', '')} {r.get('snippet', '')} {json.dumps(r.get('attributes') or {})}"
        if name_score(tokens, name_tokens(page_title(r))) < MIN_NAME_SCORE:
            continue
        words = set(re.findall(r"[A-Z]+", text.upper()))
        size = size_range(text)
        # A same-name company elsewhere is common; the preview must place it locally, unless the
        # name is distinctive (3+ significant words, all matched).
        if not (local & words) and not (len(tokens) >= 3 and tokens <= name_tokens(page_title(r))):
            continue
        return {"url": url.split("?")[0], "size_min": size[0] if size else None, "size_max": size[1] if size else None}
    return None


def find_person(results, owner, biz):
    parts = [p for p in re.findall(r"[A-Za-z'\-]+", owner) if len(p) > 1]
    if len(parts) < 2:
        return None
    first, last = parts[0].upper(), parts[-1].upper()
    tokens = name_tokens(biz["name"])
    for r in results:
        url = r.get("link") or ""
        if "linkedin.com/in/" not in url:
            continue
        title = (r.get("title") or "").upper()
        text = f"{title} {(r.get('snippet') or '').upper()}"
        # The title is "<Name> - <Role> - <Company> | LinkedIn": the person must be named there, and
        # the business mentioned in the title or preview.
        if first not in title.split(" - ")[0] or last not in title.split(" - ")[0]:
            continue
        if not tokens & name_tokens(text):
            continue
        return {"url": url.split("?")[0], "headline": (r.get("title") or "").split(" | ")[0][:120]}
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", default="OK")
    state = ap.parse_args().state.upper()
    key = os.environ.get("SERPER_API_KEY", "").strip()
    max_total = int(os.environ.get("LINKEDIN_MAX_TOTAL") or 2500)
    with psycopg.connect(database_url()) as conn, conn.cursor() as cur:
        cache = enrich.state_get(cur, STATE_KEY, {})
        if key:
            cur.execute("""select biz_key, name, city, owner_name from businesses
                           where state = %s and not is_individual and coalesce(est_method, '') <> 'branch'
                           order by est_revenue_mid desc nulls last""", (state,))
            rows = [dict(zip(["biz_key", "name", "city", "owner"], r)) for r in cur.fetchall()]
            todo = [r for r in rows if r["biz_key"] not in cache][:max(max_total - len(cache), 0)]
            print(f"linkedin: {len(todo):,} businesses to search ({len(cache):,} of {max_total:,} done)", flush=True)
            searches, stop, raw_samples = 0, False, 0

            def work(biz):
                out, n = {}, 0
                try:
                    company = google(key, f'"{short_name(biz["name"])}" {biz["city"] or ""} site:linkedin.com/company')
                    n += 1
                    out["company"] = find_company(company, biz)
                    if biz["owner"]:
                        people = google(key, f'"{biz["owner"]}" "{short_name(biz["name"])}" site:linkedin.com/in')
                        n += 1
                        out["owner"] = find_person(people, biz["owner"], biz)
                        out["owner_name"] = biz["owner"]
                except Exception as e:  # noqa: BLE001
                    return biz, None, repr(e), n, None
                return biz, out, None, n, company

            for start in range(0, len(todo), 100):
                with ThreadPoolExecutor(5) as pool:
                    for biz, found, err, n, company in pool.map(work, todo[start:start + 100]):
                        searches += n
                        if found is None:
                            if not stop:
                                print(f"linkedin: search failed ({err}); stopping for this run", flush=True)
                            stop = True
                            continue
                        cache[biz["biz_key"]] = found
                        if raw_samples < 5 and company:   # what Google shows, to check the parsing
                            raw_samples += 1
                            r = company[0]
                            print(f"  raw: {biz['name']} -> {r.get('title')} | {(r.get('snippet') or '')[:160]}", flush=True)
                enrich.state_set(cur, STATE_KEY, cache)
                if stop:
                    break
            print(f"linkedin: {searches:,} searches ≈ ${searches * SEARCH_PRICE:.2f}", flush=True)
        else:
            print("linkedin: needs SERPER_API_KEY; saving cached results only", flush=True)

        out = {}
        for k, v in cache.items():
            company, owner = (v or {}).get("company"), (v or {}).get("owner")
            if company or owner:
                out[k] = {"company_url": company and company["url"], "size_min": company and company["size_min"],
                          "size_max": company and company["size_max"],
                          "owner_url": owner and owner["url"], "owner_name": owner and v.get("owner_name")}
        n_company = sum(1 for v in out.values() if v["company_url"])
        n_size = sum(1 for v in out.values() if v["size_min"])
        n_owner = sum(1 for v in out.values() if v["owner_url"])
        print(f"linkedin: {len(cache):,} searched; company pages {n_company:,} ({n_size:,} with size), "
              f"owner profiles {n_owner:,}", flush=True)
        for v in list(out.values())[:12]:
            print(f"  sample: {v}"[:250], flush=True)
        enrich.save(cur, state, "linkedin", out)


if __name__ == "__main__":
    main()
