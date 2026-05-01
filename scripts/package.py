"""Build a clean Chrome Web Store upload zip.

Usage (from repo root):
    python scripts/package.py

Produces: dist/algolens-<version>.zip with only the files Chrome needs.
"""
from __future__ import annotations

import json
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")

FILES = [
    "manifest.json",
    "background.js",
    "content.js",
    "inline.css",
    "sidepanel.html",
    "sidepanel.css",
    "sidepanel.js",
    "onboarding.html",
    "onboarding.css",
    "onboarding.js",
    "privacy.html",
    "icons/icon16.png",
    "icons/icon32.png",
    "icons/icon48.png",
    "icons/icon128.png",
]


def main() -> int:
    with open(os.path.join(ROOT, "manifest.json"), "r", encoding="utf-8") as fh:
        version = json.load(fh)["version"]

    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, f"algolens-{version}.zip")
    if os.path.exists(out):
        os.remove(out)

    missing: list[str] = []
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for rel in FILES:
            src = os.path.join(ROOT, rel)
            if not os.path.isfile(src):
                missing.append(rel)
                continue
            zf.write(src, arcname=rel.replace("\\", "/"))

    size_kb = round(os.path.getsize(out) / 1024, 1)
    print(f"wrote {out} ({size_kb} KB)")
    if missing:
        print("missing (skipped):", ", ".join(missing), file=sys.stderr)
        return 1
    print("upload this to the Chrome Web Store developer dashboard.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
