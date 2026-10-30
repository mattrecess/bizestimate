"""Time searches and the map on the live site."""
import time
import urllib.parse
import urllib.request

SITE = "https://bizestimate-six.vercel.app"
for path in ("/api/health", f"/api/businesses?q={urllib.parse.quote('erosion control')}&limit=50",
             "/api/businesses?bbox=-97.75,35.35,-97.35,35.6&limit=50", "/api/points?bbox=-96.1,36.0,-95.8,36.25"):
    for attempt in (1, 2):
        t = time.time()
        try:
            with urllib.request.urlopen(f"{SITE}{path}{'&' if '?' in path else '?'}t={t}", timeout=90) as r:
                body = r.read()
                print(f"{r.status} {time.time() - t:5.2f}s {path} ({len(body):,} bytes)", flush=True)
        except Exception as e:  # noqa: BLE001
            print(f"FAILED {time.time() - t:5.2f}s {path} {e!r}", flush=True)
