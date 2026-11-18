#!/usr/bin/env bash
# Builds a local HLS test stream with FFmpeg (no provider, no copyright content).
# Idempotent: re-running wipes and rebuilds the playlist/segments in output/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT_DIR="$ROOT/test/streams/output"
mkdir -p "$OUT_DIR"

rm -f "$OUT_DIR"/live.m3u8 "$OUT_DIR"/*.ts
echo "[stream] generating testsrc2 + sine -> $OUT_DIR/live.m3u8"

ffmpeg -y -hide_banner -loglevel warning \
  -f lavfi -i "testsrc2=size=1280x720:rate=25" \
  -f lavfi -i "sine=frequency=440:sample_rate=48000" \
  -c:v libx264 -preset veryfast -tune zerolatency \
  -b:v 2500k -maxrate 2500k -bufsize 5000k -g 48 \
  -c:a aac -b:a 128k \
  -f hls -hls_time 4 -hls_list_size 6 \
  -hls_flags delete_segments+omit_endlist \
  "$OUT_DIR/live.m3u8" &
FFMPEG_PID=$!

# Stop cleanly on Ctrl-C / kill so no orphan ffmpeg keeps writing segments.
trap 'kill "$FFMPEG_PID" 2>/dev/null || true' INT TERM EXIT

# Playlists for the app: localhost and the first LAN address (for a TV).
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [ -n "$LAN_IP" ]; then
  cat > "$OUT_DIR/demo-lan.m3u" <<EOF
#EXTM3U
#EXTINF:-1 tvg-id="local-test" group-title="Local",Local HLS Test
http://$LAN_IP:8080/live.m3u8
EOF
else
  echo "[stream] no LAN address found, only demo-local.m3u written"
fi
cat > "$OUT_DIR/demo-local.m3u" <<'EOF'
#EXTM3U
#EXTINF:-1 tvg-id="local-test" group-title="Local",Local HLS Test
http://127.0.0.1:8080/live.m3u8
EOF

echo "[stream] serving on http://127.0.0.1:8080/live.m3u8"
wait "$FFMPEG_PID"
