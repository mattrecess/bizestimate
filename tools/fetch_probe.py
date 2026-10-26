"""Probe Oklahoma Secretary of State business records access (search page, data portal)."""
import re
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36"}
URLS = [
    "https://www.sos.ok.gov/corp/corpInquiryFind.aspx",
    "https://www.sos.ok.gov/corp/corpInformation.aspx",
    "https://www.sos.ok.gov/business/default.aspx",
    "https://data.ok.gov/api/3/action/package_search?q=business%20entity&rows=20",
    "https://data.ok.gov/api/3/action/package_search?q=secretary%20of%20state&rows=20",
    "https://api.opencorporates.com/v0.4/companies/search?q=hunter+mechanical&jurisdiction_code=us_ok",
]
for url in URLS:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
            body = r.read(400_000).decode("utf-8", "replace")
            print(f"== {r.status} {url} ({len(body)} bytes)")
            print("   captcha:", bool(re.search(r"captcha|turnstile|hcaptcha", body, re.I)),
                  "| viewstate:", "__VIEWSTATE" in body)
            title = re.search(r"<title>(.*?)</title>", body, re.S)
            print("   title:", title.group(1).strip()[:100] if title else "")
            inputs = re.findall(r'<input[^>]+name="([^"]+)"', body)
            print("   inputs:", [i for i in inputs if not i.startswith("__")][:15])
            if "package_search" in url:
                for m in re.findall(r'"title": "([^"]+)"', body)[:20]:
                    print("   dataset:", m)
            if "opencorporates" in url:
                print("   ", body[:300])
    except Exception as e:  # noqa: BLE001
        print(f"== ERR {url}: {e!r}")
