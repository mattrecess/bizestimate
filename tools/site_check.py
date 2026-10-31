"""Check the live site after a deploy: main pages and APIs answer quickly and with real data.

    python tools/site_check.py https://www.seebitda.com

Exits with an error listing what failed (the Run alerts workflow then opens an issue).
"""
import json
import sys
import time
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "https://www.seebitda.com").rstrip("/")
SLOW = 8.0   # seconds; a cold start can take a few, more than this is a problem


def get(path):
    t = time.time()
    with urllib.request.urlopen(BASE + path, timeout=30) as r:
        body = r.read()
        return r.status, body, time.time() - t


problems = []


def check(name, path, test=None):
    try:
        status, body, secs = get(path)
        ok = status == 200 and (test is None or test(body))
        print(f"{'ok  ' if ok else 'FAIL'} {secs:5.2f}s {name} ({path})", flush=True)
        if not ok:
            problems.append(f"{name}: unexpected response")
        elif secs > SLOW:
            problems.append(f"{name}: slow ({secs:.1f}s)")
        return body
    except Exception as e:  # noqa: BLE001
        print(f"FAIL {name} ({path}): {e!r}", flush=True)
        problems.append(f"{name}: {e!r}")
        return None


j = lambda b: json.loads(b)   # noqa: E731
check("home page", "/", lambda b: b"SeeBITDA" in b)
listing = check("business list", "/api/businesses?limit=5", lambda b: len(j(b)["results"]) == 5)
check("business count", "/api/businesses/count", lambda b: j(b)["total"] > 1000)
check("map pins", "/api/points", lambda b: len(j(b)["features"]) > 100)
check("search", "/api/businesses?q=janitorial&limit=3", lambda b: len(j(b)["results"]) > 0)
if listing:
    first = j(listing)["results"][0]["id"]
    check("business profile (panel)", f"/api/businesses/{first}?core=1", lambda b: j(b).get("name"))
    check("business profile (related)", f"/api/businesses/{first}/related", lambda b: "comps" in j(b))
    check("business page", f"/business/{first}", lambda b: b"Est" in b)
check("industry pages", "/oklahoma", lambda b: b"/oklahoma/" in b)
check("NAICS list", "/api/naics", lambda b: len(j(b)) > 100)
check("lenders", "/api/lenders", lambda b: isinstance(j(b), list))
check("sitemap", "/sitemap.xml", lambda b: b"<sitemapindex" in b)

if problems:
    print("\nProblems:\n  " + "\n  ".join(problems), flush=True)
    sys.exit(1)
print("\nAll checks passed", flush=True)
