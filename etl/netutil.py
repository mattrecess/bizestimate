"""urlopen with a browser-like User-Agent; some government sites reject Python's default."""
import urllib.request

HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/124.0 Safari/537.36 BizEstimate-ETL",
    "Accept": "*/*",
}


def urlopen(url, data=None, headers=None, timeout=300):
    req = urllib.request.Request(url, data=data, headers={**HEADERS, **(headers or {})})
    return urllib.request.urlopen(req, timeout=timeout)
