"""Prove this pack regenerates from its own source.

Run from anywhere, after `npm ci` and `pip install -r requirements.txt` in this folder:

    python verify.py

It runs the build chain here, then compares every file pack-manifest.json says was
generated against what this run produced, byte for byte. Then it serves the pack over
HTTP and fetches every file index.html names. Exit status 0 means all of it held.
"""
import functools
import hashlib
import http.server
import json
import os
import re
import subprocess
import sys
import threading
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PACK = os.path.dirname(HERE)


def run(*cmd):
    print("$", " ".join(cmd))
    subprocess.run(cmd, cwd=HERE, check=True)


def sha(p):
    with open(p, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def main():
    py = sys.executable
    run(py, "build.py")
    run("node", "raster.js")
    run(py, "board.py")
    run("node", "raster.js", "board")

    with open(os.path.join(PACK, "pack-manifest.json"), encoding="utf-8") as f:
        manifest = json.load(f)
    same, differ = 0, []
    for packed, entry in manifest["files"].items():
        if not entry["regen"]:
            continue
        a = os.path.join(PACK, *packed.split("/"))
        b = os.path.join(HERE, *entry["regen"].split("/"))
        if os.path.exists(b) and sha(a) == sha(b):
            same += 1
        else:
            differ.append(packed)
    total = same + len(differ)
    print(f"regenerated: {same} of {total} identical")
    for p in differ:
        print("  differs:", p)

    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=PACK))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}/"
    html = urllib.request.urlopen(base + "index.html").read().decode("utf-8")
    refs = sorted(set(r for r in re.findall(r'(?:src|href)="([^"#]+)"', html)
                      if not r.startswith(("http:", "https:", "data:", "mailto:"))))
    broken = []
    for r in refs:
        try:
            body = urllib.request.urlopen(base + r).read()
            if r.endswith(".png") and not body.startswith(b"\x89PNG"):
                broken.append(r + " (not a PNG)")
            if r.endswith(".svg") and b"<svg" not in body[:400]:
                broken.append(r + " (not an SVG)")
        except Exception as e:  # noqa: BLE001
            broken.append(f"{r} ({e})")
    srv.shutdown()
    print(f"served: {len(refs)} files named by index.html, {len(broken)} broken")
    for b in broken:
        print("  broken:", b)
    sys.exit(1 if differ or broken else 0)


if __name__ == "__main__":
    main()
