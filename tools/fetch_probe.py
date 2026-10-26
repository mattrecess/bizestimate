"""Probe Oklahoma vendor payments through the open-data portal's official CKAN API."""
import json
import urllib.request

RES = "bf8ea5aa-a3ad-489a-9d7b-49c532d4b5ae"
for label, url in [
    ("datastore", f"https://data.ok.gov/api/3/action/datastore_search?resource_id={RES}&limit=3"),
    ("package 2027", "https://data.ok.gov/api/3/action/package_show?id=state-of-oklahoma-vendor-payments-fiscal-year-2027"),
]:
    try:
        with urllib.request.urlopen(url, timeout=120) as r:
            data = json.loads(r.read())
        print(f"== {label}: OK")
        result = data.get("result", {})
        for res in result.get("resources", []):
            print("   resource:", res.get("name"), res.get("datastore_active"), res.get("url"))
        if "records" in result:
            print("   fields:", [f["id"] for f in result.get("fields", [])])
            for rec in result["records"]:
                print("   ", json.dumps(rec)[:500])
            print("   total:", result.get("total"))
    except Exception as e:  # noqa: BLE001
        print(f"== {label}: {e!r}")
