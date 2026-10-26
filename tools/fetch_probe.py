"""Look up businesses on the live site and print what we know about their owners."""
import json
import urllib.parse
import urllib.request

SITE = "https://bizestimate-six.vercel.app"
for q in ("lavicky",):
    with urllib.request.urlopen(f"{SITE}/api/businesses?limit=8&q=" + urllib.parse.quote(q), timeout=60) as r:
        data = json.loads(r.read())
    print(f"== {q}: {data['total']} found")
    for b in data["results"][:8]:
        with urllib.request.urlopen(f"{SITE}/api/businesses/{b['id']}", timeout=60) as r2:
            p = json.loads(r2.read())
        print(f"   {b['name']} ({b['city']}) id {b['id']} naics {b['naics']} rev {float(b['est_revenue_mid'] or 0):,.0f} "
              f"jobs {b.get('jobs_reported')} | owner: {p.get('owner_name')} ({p.get('owner_title')}) src {p.get('owner_source')} | web {p.get('website')}")
        for s in p.get("sources") or []:
            print(f"     {s['source']}: {json.dumps(s['data'])[:400]}")
