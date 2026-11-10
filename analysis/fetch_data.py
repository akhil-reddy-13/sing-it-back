"""Download all events from the deployed study.

    ADMIN_TOKEN=... python3 analysis/fetch_data.py https://your-app.vercel.app

Writes data/events.ndjson (overwrites). Raw data never go in git.
"""
import json, os, pathlib, sys, urllib.request

base = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else sys.exit(__doc__)
token = os.environ.get("ADMIN_TOKEN") or sys.exit("set ADMIN_TOKEN")
out = pathlib.Path(__file__).resolve().parents[1] / "data" / "events.ndjson"
out.parent.mkdir(exist_ok=True)
after, n = 0, 0
with out.open("w") as f:
    while True:
        req = urllib.request.Request(f"{base}/api/export?after={after}", headers={"Authorization": f"Bearer {token}"})
        rows = [json.loads(l) for l in urllib.request.urlopen(req).read().decode().splitlines() if l.strip()]
        if not rows:
            break
        for r in rows:
            f.write(json.dumps(r) + "\n")
        after, n = rows[-1]["id"], n + len(rows)
print(f"wrote {n} events to {out}")
