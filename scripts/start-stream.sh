#!/usr/bin/env bash
# Serves the generated HLS stream on port 8080 (LAN accessible for the TV)
# with CORS headers so the app can fetch it cross-origin from the dev server.
# Idempotent: fails with instructions when the stream has not been generated yet.
set -euo pipefail

DIR="$(cd "$(dirname "$0")/../test/streams/output" && pwd)"
if [ ! -f "$DIR/live.m3u8" ]; then
  echo "No live.m3u8 found. Run first: test/streams/make-test-stream.sh"
  exit 1
fi
echo "[stream] http://localhost:8080/live.m3u8 (CORS enabled)"
exec python3 "$(dirname "$0")/stream_server.py" --port 8080 --bind 0.0.0.0 --directory "$DIR"
