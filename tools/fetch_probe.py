"""Inspect the largest estimates on the live site: method, headcounts, industry, figures."""
import json
import urllib.request

SITE = "https://bizestimate-six.vercel.app"
get = lambda p: json.loads(urllib.request.urlopen(SITE + p, timeout=60).read())  # noqa: E731
rows = get("/api/businesses?limit=25")["results"]
for b in rows:
    p = get(f"/api/businesses/{b['id']}?core=1")
    hc = [(h["year"], h["employees"]) for h in p.get("headcounts") or []]
    srcs = sorted(s["source"] for s in p.get("sources") or [])
    print(f"{b['name'][:34]:34} rev {float(b['est_revenue_mid'] or 0)/1e9:7.2f}B  {b['est_method']:16} naics {b['naics']} "
          f"'{p.get('industry')}' rpe {p.get('revenue_per_employee')} ppp_jobs {b.get('jobs_reported')} infl {p.get('est_inflation')} "
          f"5500 {hc[-3:]} src {srcs}")
for n in ["Lavicky", "Minick", "AAA Landscape", "Red Dirt Septic", "Vantage Point"]:
    hits = get(f"/api/businesses?q={urllib.request.quote(n)}&limit=1")["results"]
    for b in hits:
        print(f"CHECK {b['name'][:34]:34} rev ${float(b['est_revenue_mid'] or 0)/1e6:,.1f}M  {b['est_method']}  owner {b.get('owner_name')}")
