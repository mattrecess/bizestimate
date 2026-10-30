"""Time the list (right-hand panel) requests for typical views on the live site."""
import time
import urllib.request

SITE = "https://bizestimate-six.vercel.app"
VIEWS = {
    "statewide": "/api/businesses?bbox=-103.2,33.5,-94.3,37.1&limit=50",
    "OKC": "/api/businesses?bbox=-97.75,35.35,-97.35,35.6&limit=50",
    "Tulsa": "/api/businesses?bbox=-96.1,36.0,-95.8,36.25&limit=50",
    "OKC zoomed": "/api/businesses?bbox=-97.56,35.45,-97.48,35.5&limit=50",
    "no bbox": "/api/businesses?limit=50",
}
for name, path in VIEWS.items():
    for attempt in (1, 2):
        t = time.time()
        try:
            with urllib.request.urlopen(f"{SITE}{path}&t={t}", timeout=90) as r:
                r.read()
                print(f"{name:11} try {attempt}: {r.status} {time.time() - t:5.2f}s", flush=True)
        except Exception as e:  # noqa: BLE001
            print(f"{name:11} try {attempt}: FAILED {time.time() - t:5.2f}s {e!r}", flush=True)
