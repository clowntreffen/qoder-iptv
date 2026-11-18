# Testing without a TV

Local test environment for the app and its HLS playback, without any provider,
external IPTV source or LG TV. Everything is generated on this machine and all
scripts are idempotent (safe to re-run).

## Tools

| Tool | Version used | Purpose |
| --- | --- | --- |
| Node.js | 22.x (see `.nvmrc`) | build + unit tests |
| FFmpeg | 6.1.x | local HLS test stream |
| Python 3 | 3.x | static file servers (no install needed) |

Check with:

```bash
node -v; npm -v; ffmpeg -version | head -1; python3 -V
```

`ares`/webOS CLI is **not required** for this local setup. It is only needed to
package or install the IPK (`npm run package`).

## Layout

```text
test/
├── browser/stream-test.html     # standalone HLS playback check page
└── streams/
    ├── make-test-stream.sh      # FFmpeg -> live.m3u8 (endless, live)
    └── output/                  # generated playlist/segments (git-ignored)
scripts/
├── start-stream.sh              # port 8080, stream only (LAN accessible)
└── start-web.sh                 # port 8081, project root for the browser page
```

## Ports

| Port | Bind | Serves |
| --- | --- | --- |
| 8080 | `0.0.0.0` | `live.m3u8` + segments (use the LAN IP on a TV/browser) |
| 8081 | `127.0.0.1` | project root: test page, `node_modules/hls.js`, stream copy |

## Steps

1. Generate the stream (runs until stopped, Ctrl-C is safe):

   ```bash
   ./test/streams/make-test-stream.sh
   ```

   Writes `test/streams/output/live.m3u8` plus two ready-to-import playlists:
   `demo-local.m3u` (localhost) and `demo-lan.m3u` (first LAN address).

2. Serve it (second terminal):

   ```bash
   ./scripts/start-stream.sh
   ```

3. Browser check of the raw HLS stream (third terminal):

   ```bash
   ./scripts/start-web.sh
   # open http://127.0.0.1:8081/test/browser/stream-test.html
   ```

   Same-origin paths avoid CORS entirely. Optional explicit URL:

   ```
   http://127.0.0.1:8081/test/browser/stream-test.html?url=http://192.168.1.50:8080/live.m3u8
   ```

4. App in the browser against the local stream:

   ```bash
   npm run dev
   # add a source pointing at http://127.0.0.1:8080/demo-local.m3u
   ```

   Never point the app's M3U source at `live.m3u8` directly: that file is an
   HLS media playlist, not a channel list.

   On the TV later: add `http://<PC-LAN-IP>:8080/demo-lan.m3u` as the source
   URL (or sideload that file).

5. Full headless end-to-end test (no TV, no provider):

   ```bash
   ./scripts/start-stream.sh          # stream on :8080
   npm run smoke                      # builds dist/, serves :5199, Playwright Chromium
   ```

   Checks: production build, app boots, video plays and advances, short OK =
   info, BACK = exit dialog, held OK = channel list, BACK closes it. Writes
   screenshots to `test/browser/shots/`. Exits non-zero on failure.
   `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` keeps `npm i` from fetching Chromium
   (the browser is only needed for `npm run smoke`).

## Checks

- Stream advances: `curl -s http://127.0.0.1:8080/live.m3u8 | grep MEDIA-SEQUENCE`
  changes over time.
- Page reports `manifest parsed` and `playing`.
- No CORS errors (same origin on 8081).
- Unit tests still cover the app itself: `npm test` (505 tests).

## Known limits

- No DRM, no real TV panel/Magic Remote: key handling is verified by the
  automated `node --test` suites with a fake DOM, not on hardware.
- `testsrc2` + sine is synthetic content only; it says nothing about real
  provider behaviour (remux warm-up etc.).
- The webOS Simulator is optional and not part of this local setup.
- First playlist write takes ~6 s after starting FFmpeg.
