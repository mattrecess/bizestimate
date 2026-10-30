"""Check the custom domain: home page, www redirect, health check, and which address the sitemap uses."""
import time
import urllib.request

for url in ("https://seebitda.com/", "https://www.seebitda.com/", "https://seebitda.com/api/health",
            "https://seebitda.com/sitemap.xml", "https://seebitda.com/robots.txt"):
    t = time.time()
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "SeeBITDA check"}), timeout=60) as r:
            body = r.read(600).decode("utf-8", "replace")
            print(f"{r.status} {time.time() - t:4.1f}s {url} -> {r.geturl()}\n   {body[:300]!r}", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"FAILED {url} {e!r}", flush=True)
