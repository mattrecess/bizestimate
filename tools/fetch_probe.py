"""Check whether Foursquare's open places data (FSQ OS Places) can be read without an account."""
import urllib.request

URLS = [
    "https://fsq-os-places-us-east-1.s3.amazonaws.com/?list-type=2&prefix=release/&delimiter=/",
    "https://fsq-os-places-us-east-1.s3.amazonaws.com/?list-type=2&prefix=release/dt=&max-keys=20",
    "https://huggingface.co/api/datasets/foursquare/fsq-os-places",
    "https://huggingface.co/api/datasets/foursquare/fsq-os-places/tree/main",
]
for url in URLS:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "bizestimate-probe"}), timeout=60) as r:
            print(f"{url}\n  HTTP {r.status}\n  {r.read(3000).decode('utf-8', 'replace')}\n", flush=True)
    except Exception as e:  # noqa: BLE001
        body = getattr(e, "read", lambda: b"")()[:1000]
        print(f"{url}\n  FAILED {e!r}\n  {body!r}\n", flush=True)
