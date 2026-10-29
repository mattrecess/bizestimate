"""Inspect how a multi-location business is listed on the live site."""
import json
import urllib.parse
import urllib.request

SITE = "https://bizestimate-six.vercel.app"
get = lambda p: json.loads(urllib.request.urlopen(SITE + p, timeout=60).read())  # noqa: E731
for q in ["cook feed", "cooks feed"]:
    r = get(f"/api/businesses?q={urllib.parse.quote(q)}&limit=40")
    print(f"== {q!r}: {r['total']} results")
    for b in r["results"]:
        p = get(f"/api/businesses/{b['id']}?core=1")
        print(f"  {b['id']} {b['name']!r} | {b.get('address')}, {b['city']} {b['zip']} | {b['est_method']} | naics {b['naics']} "
              f"| rev {float(b['est_revenue_mid'] or 0)/1e6:.1f}M | parent {b.get('parent_name')} | locs {b.get('locations')} "
              f"| ppp loans {len(p.get('loans') or [])} | key {p.get('key_source')} | site {p.get('website')}")
