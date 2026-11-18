# Qoder IPTV Player for LG webOS

> Custom fork of [HCLGitHub/qoder-iptv](https://github.com/HCLGitHub/qoder-iptv). Original project and copyright: HCLGitHub, MIT licensed.

An open-source M3U / IPTV player for LG webOS TVs (webOS 5.3+, tested on webOS 6 and later), built with Vite and [hls.js](https://github.com/video-dev/hls.js).

**No channels, playlists, programmes or EPG data are included.** You add your own M3U playlist and XMLTV/DIYP EPG sources. Only use content you are legally entitled to access. The app does not bypass accounts, authentication or DRM.

## Download this fork
[com.qoder.iptv_1.1.75_all.ipk](https://github.com/clowntreffen/qoder-iptv/releases/download/v1.1.75/com.qoder.iptv_1.1.75_all.ipk) — built from this fork, not from upstream.  
SHA256: `8d131a20433fa0ec6b1d0103c4bc28048b67abfd52480ed128eaef720a2263e1`

Install with LG webOS dev mode / Glasshouse. No playlists, channels or EPG data are included.

## Changes in this fork
See [CHANGELOG.md](CHANGELOG.md) for the full fork history.
- Rebranded as **Qoder IPTV** with a new textless purple/blue TV-play icon and English app description.
- Favourites are always visible as the first group in the channel menu. Add/remove with **Yellow** while watching or in the channel list, **INFO** on remotes that have it, or by tapping the ☆/★ next to a channel.
- Channel keys are aligned: **CH+ / D-pad UP** = next channel, **CH- / D-pad DOWN** = previous channel.
- Source liveness check waits longer before marking a source dead: **3 s per request / 6 s total** (was 1.2 s / 2.5 s). A request that only times out is treated as *unknown* and stays in the list, so slow proxies and redirect gates are not falsely marked dead; only hard failures become dead URLs. Source-test results now expire after 12 hours.
- Added a runtime stall watchdog, optional M3U/EPG auto-refresh with offline cache fallback, channel search and recently watched channels, EPG details/reminders, audio/subtitle track selection, parental PIN, sleep timer and JSON backup/restore.
- Packaging targets **Node.js 20+** (`.nvmrc` = 22) and the app declares `requiredACG: []`.
- Remote-key documentation updated for the LG C5/MR25GA Magic Remote.

## Screenshots
| Channel menu with EPG and catch-up | Settings | Playback info bar |
| --- | --- | --- |
| ![Channel menu](docs/screenshots/channels-epg.png) | ![Settings](docs/screenshots/settings.png) | ![Playback](docs/screenshots/playback-osd.png) |

Demo video recorded on a real LG TV: [docs/demo.mp4](docs/demo.mp4)

## Test environment (no TV needed)

```bash
./test/streams/make-test-stream.sh     # FFmpeg local HLS test stream
./scripts/start-stream.sh              # stream on http://localhost:8080/live.m3u8
./scripts/start-web.sh                 # browser test page on http://127.0.0.1:8081/test/browser/stream-test.html
npm run smoke                          # headless Chromium E2E: build, play, OK/BACK keys
```

Synthetic `testsrc2` + sine, no provider or copyrighted content. Details, ports and the app-against-local-stream workflow: [docs/TESTING.md](docs/TESTING.md).

## Features
- Multiple M3U/M3U8 sources: add, edit, switch, delete; channels merged by group and name
- Four-column channel menu: groups, channels (logo, number, now playing), programmes, dates
- XMLTV and DIYP EPG: now/next and a full-screen programme guide
- Catch-up playback via `catchup` / `catchup-source` / `catchup-days`, with seek and playback speed control
- Fast channel switching: adjacent-channel prefetch and tunable buffering
- Number-key zapping, favourites, recently watched channels and channel search
- Runtime stall detection with automatic backup-source failover
- Optional M3U/EPG auto-refresh with offline cache fallback
- EPG programme details and reminders
- Audio-track and subtitle-track selection
- Parental PIN with optional startup lock, sleep timer, and JSON settings backup/restore
- Aspect ratio, native / hls.js decoder switch, remembers the last channel
- Per-channel customization: rename, hide, move up/down, regroup, EPG offset, clear (MENU key in the channel menu)
- Eight color themes and six text-size steps (80%–130%)
- EPG programme search with catch-up playback for past programmes
- Seek-preview thumbnails in the catch-up bar (explicit `seek_preview`, Flussonic, Nimble Streamer)
- Interface is fixed to English; no locale-based Chinese UI

## Remote keys
| Key | While playing |
| --- | --- |
| OK | Channel menu |
| ← / → | Switch to the previous / next source of the channel (opens the menu if there is only one) |
| ↑ / ↓ | Next / previous channel |
| CH+ / CH- | Next / previous channel |
| Numbers | Go to channel number |
| Red | Programme guide (EPG) |
| Green | Settings |
| Yellow | Add / remove favourite |
| Blue | Source manager |
| INFO | Info bar |
| FF / REW | ±30 s in catch-up |
| Stop / Back | Return to live from catch-up |

In the channel menu, **Blue** opens channel search, **Yellow/INFO** toggles the favourite, and **MENU** opens per-channel customization (rename / hide / move / regroup / EPG offset). In the full-screen EPG guide, **Yellow/INFO** adds or removes a reminder for the selected programme.

## Build
Requires Node.js 20+ (Node 22 recommended; see `.nvmrc`).
```sh
npm install
npm test          # unit tests
npm run dev       # browser preview at http://localhost:5173 (keyboard emulates the remote)
npm run package   # builds dist/ and creates com.qoder.iptv_<version>_all.ipk
```
In the browser, M3U/EPG requests may hit CORS limits; the dev server provides a local proxy. The webOS app itself has no such restriction.

## Install
- Download the IPK from [Releases](https://github.com/clowntreffen/qoder-iptv/releases) and install it with [Glasshouse](https://github.com/rorygallagher2024/glasshouse) (upload the IPK), or with `ares-install --device tv <file>.ipk`.

## Known limitations
- **No LAN upload/setup service.** The upstream reference implementation ships a bundled webOS Node service (Node 0.12, Luna + HTTP) to push playlists from a computer over the local network. This fork is a pure web app and cannot bundle that service; it also could not be validated without a physical TV. Add playlists through the on-TV source manager instead.

## License
[MIT](LICENSE). Bundled third-party software: hls.js (Apache License 2.0); see [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt).
