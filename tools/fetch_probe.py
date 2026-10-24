"""Check which SEC endpoints accept our requests from GitHub (and what a refusal says)."""
import urllib.error
import urllib.request

UAS = ["BizEstimate mattrecess@users.noreply.github.com", "BizEstimate admin@bizestimate.com",
       "Matt Recess mattrecess@users.noreply.github.com"]
URLS = ["https://data.sec.gov/submissions/CIK0001090012.json",
        "https://www.sec.gov/files/company_tickers.json",
        "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&State=OK&type=10-K&dateb=&owner=include&count=100&start=0",
        "https://efts.sec.gov/LATEST/search-index?q=%22Oklahoma%22&forms=10-K"]
for ua in UAS:
    for url in URLS:
        req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept-Encoding": "identity", "Host": url.split("/")[2]})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                print("OK ", r.status, len(r.read()), ua[:30], url[:90])
        except urllib.error.HTTPError as e:
            print("ERR", e.code, ua[:30], url[:90], e.read()[:300])
