"""How do key pages respond to a crawler: status, time, redirects, robots directives, size."""
import re
import time
import urllib.request

UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
for url in ("https://www.seebitda.com/", "https://www.seebitda.com/likely-to-sell", "https://www.seebitda.com/oklahoma"):
    for attempt in (1, 2):
        t = time.time()
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60) as r:
                body = r.read().decode("utf-8", "replace")
                robots = re.findall(r'<meta[^>]+name="robots"[^>]*>', body)
                print(f"{r.status} {time.time() - t:5.1f}s {url} final={r.geturl()} bytes={len(body):,} "
                      f"x-robots={r.headers.get('x-robots-tag')} meta={robots} title={re.search(r'<title>(.*?)</title>', body).group(1) if '<title>' in body else None}", flush=True)
        except Exception as e:  # noqa: BLE001
            print(f"FAILED {time.time() - t:5.1f}s {url} {e!r}", flush=True)
