"""Is the live site's database reachable? Hits the uncached health check and a list request."""
import time
import urllib.request

SITE = "https://bizestimate-six.vercel.app"
for path in ("/api/health", "/api/health", "/api/businesses?limit=1"):
    t = time.time()
    try:
        with urllib.request.urlopen(f"{SITE}{path}{'&' if '?' in path else '?'}t={t}", timeout=60) as r:
            print(f"{r.status} {time.time() - t:5.2f}s {path} {r.read(200)!r}", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"FAILED {time.time() - t:5.2f}s {path} {e!r} {getattr(e, 'read', lambda: b'')()[:200]!r}", flush=True)
