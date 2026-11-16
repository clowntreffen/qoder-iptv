# Qoder IPTV Player for LG webOS

> Custom fork of [HCLGitHub/qoder-iptv](https://github.com/HCLGitHub/qoder-iptv). Original project and copyright: HCLGitHub, MIT licensed.

An open-source M3U / IPTV player for LG webOS TVs (webOS 5.3+, tested on webOS 6 and later), built with Vite and [hls.js](https://github.com/video-dev/hls.js).

**No channels, playlists, programmes or EPG data are included.** You add your own M3U playlist and XMLTV/DIYP EPG sources. Only use content you are legally entitled to access. The app does not bypass accounts, authentication or DRM.

## Download this fork
[com.qoder.iptv_1.1.64_all.ipk](https://github.com/clowntreffen/qoder-iptv/releases/download/v1.1.64/com.qoder.iptv_1.1.64_all.ipk) — built from this fork, not from upstream.  
SHA256: `2ef1d27ee68def941008b7a10ec22aa68c0d79d0efcec818634f0f25dc5fba65`

Install with LG webOS dev mode / Glasshouse. No playlists, channels or EPG data are included.

## Changes in this fork
See [CHANGELOG.md](CHANGELOG.md) for the full fork history.
- Rebranded as **Qoder IPTV** with a new textless purple/blue TV-play icon and English app description.
- Favourites are always visible as the first group in the channel menu. Add/remove with **Yellow** while watching or in the channel list, **INFO/MENU** on remotes that have them, or by tapping the ☆/★ next to a channel.
- Channel keys are aligned: **CH+ / D-pad UP** = next channel, **CH- / D-pad DOWN** = previous channel.
- Source liveness check waits longer before marking a source dead: **3 s per request / 6 s total** (was 1.2 s / 2.5 s), so slow IPTV gateways are not falsely marked dead. Source-test results now expire after 12 hours.
- Added a runtime stall watchdog, optional M3U/EPG auto-refresh with offline cache fallback, channel search and recently watched channels, EPG details/reminders, audio/subtitle track selection, parental PIN, sleep timer and JSON backup/restore.
- Packaging targets **Node.js 20+** (`.nvmrc` = 22) and the app declares `requiredACG: []`.
- Remote-key documentation updated for the LG C5/MR25GA Magic Remote.

## Screenshots
| Channel menu with EPG and catch-up | Settings | Playback info bar |
| --- | --- | --- |
| ![Channel menu](docs/screenshots/channels-epg.png) | ![Settings](docs/screenshots/settings.png) | ![Playback](docs/screenshots/playback-osd.png) |

Demo video recorded on a real LG TV: [docs/demo.mp4](docs/demo.mp4)

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
- Interface language follows the system (Chinese or English) and can be switched in Settings

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

In the channel menu, **Blue** opens channel search and **Yellow/INFO/MENU** toggles the favourite. In the full-screen EPG guide, **Yellow/INFO** adds or removes a reminder for the selected programme.

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

## License
[MIT](LICENSE). Bundled third-party software: hls.js (Apache License 2.0); see [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt).
