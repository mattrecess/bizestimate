"""Current public estimates for a few businesses (from the live site's search API)."""
import json
import urllib.parse
import urllib.request

for q in ("minick materials", "aaa landscape", "red dirt septic", "vantage point itad", "hunter mechanical"):
    url = "https://bizestimate-six.vercel.app/api/businesses?limit=5&q=" + urllib.parse.quote(q)
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            data = json.loads(r.read())
        print(f"== {q}: {data['total']} found")
        for b in data["results"][:4]:
            print(f"   {b['name']} ({b['city']}) rev {float(b['est_revenue_mid'] or 0):,.0f} ebitda {float(b['est_ebitda_mid'] or 0):,.0f} "
                  f"jobs {b.get('jobs_reported')} {b['est_method']} naics {b['naics']}")
    except Exception as e:  # noqa: BLE001
        print(f"== {q}: {e!r}")
