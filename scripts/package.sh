#!/usr/bin/env bash
# Thin wrapper around scripts/package.py for POSIX users.
# Produces: dist/algolens-<version>.zip
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
python "$ROOT/scripts/package.py"
