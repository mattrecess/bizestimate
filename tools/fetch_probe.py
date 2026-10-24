"""Find the newest IRS Corporation Source Book flat files and show their layout (run on GitHub)."""
import io
import sys
import zipfile

sys.path.insert(0, "etl")
from netutil import urlopen  # noqa: E402

BASE = "https://www.irs.gov/pub/irs-soi/"
found = []
for yy in range(13, 25):
    for name in (f"{yy}sbfltfile.zip", f"{yy}sbflatfile.zip", f"{yy}sbfltfile.csv"):
        try:
            with urlopen(BASE + name, timeout=60) as r:
                data = r.read()
            print(f"OK {name} {len(data):,} bytes", flush=True)
            found.append((name, data))
            break
        except Exception as e:  # noqa: BLE001
            print(f"-- {name}: {e}", flush=True)

for name, data in found[-1:] + found[:1]:
    print(f"\n===== {name}")
    if name.endswith(".zip"):
        z = zipfile.ZipFile(io.BytesIO(data))
        for info in z.infolist():
            print("  member:", info.filename, f"{info.file_size:,}")
        for info in z.infolist():
            raw = z.read(info.filename)
            text = raw.decode("latin-1")
            lines = text.splitlines()
            print(f"--- {info.filename}: {len(lines):,} lines; first 25:")
            for l in lines[:25]:
                print("   ", l[:400])
            if len(lines) > 25:
                print("   ...")
                for l in lines[1000:1006]:
                    print("   ", l[:400])
