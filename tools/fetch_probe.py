"""Dump one business's profile from the live site (for the layout mockup)."""
import json
import urllib.request

SITE = "https://bizestimate-six.vercel.app"
get = lambda p: json.loads(urllib.request.urlopen(SITE + p, timeout=90).read())  # noqa: E731
core = get("/api/businesses/1294710?core=1")
related = get("/api/businesses/1294710/related")
keep = {k: v for k, v in core.items() if k not in ("sources",)}
print(json.dumps(keep, default=str)[:6000])
print("SOURCES", json.dumps([{"source": s["source"], "data": s["data"]} for s in core.get("sources") or []], default=str)[:6000])
print("RELATED", json.dumps(related, default=str)[:5000])
