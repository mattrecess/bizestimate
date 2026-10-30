"""Check the sitemap, robots and a business page use the www.seebitda.com address."""
import re
import urllib.request

for url in ("https://www.seebitda.com/sitemap.xml", "https://www.seebitda.com/robots.txt", "https://www.seebitda.com/sitemaps/pages"):
    with urllib.request.urlopen(url, timeout=60) as r:
        body = r.read().decode("utf-8", "replace")
    print(url, "->", sorted(set(re.findall(r"https?://[a-z0-9.-]+", body)))[:5], flush=True)
