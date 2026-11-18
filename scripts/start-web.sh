#!/usr/bin/env bash
# Serves the project root on 127.0.0.1:8081 for browser tests.
# Same-origin paths used by the test page:
#   /test/browser/stream-test.html
#   /test/streams/output/live.m3u8
#   /node_modules/hls.js/dist/hls.min.js
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec python3 -m http.server 8081 --bind 127.0.0.1 --directory "$ROOT"
