# Qoder IPTV Player for LG webOS

> Custom fork of [HCLGitHub/qoder-iptv](https://github.com/HCLGitHub/qoder-iptv). Original project and copyright: HCLGitHub, MIT licensed.

An open-source M3U / IPTV player for LG webOS TVs (webOS 5.3+, tested on webOS 6 and later), built with Vite and [hls.js](https://github.com/video-dev/hls.js).

**No channels, playlists, programmes or EPG data are included.** You add your own M3U playlist and XMLTV/DIYP EPG sources. Only use content you are legally entitled to access. The app does not bypass accounts, authentication or DRM.

## Download this fork
[com.qoder.iptv_1.1.60_all.ipk](https://github.com/clowntreffen/qoder-iptv/releases/download/v1.1.60/com.qoder.iptv_1.1.60_all.ipk) — built from this fork, not from upstream.  
SHA256: `e580c27e982d4cab9c7bf13ac6acc00a75c74c7c80c6f2e110e239046906b8eb`

Install with LG webOS dev mode / Glasshouse. No playlists, channels or EPG data are included.

## Changes in this fork
- Rebranded as **Qoder IPTV** with a new textless purple/blue TV-play icon and English app description.
- Favourites are always visible as the first group in the channel menu. Add/remove with **Yellow** while watching or in the channel list, **INFO/MENU** on remotes that have them, or by tapping the ☆/★ next to a channel.
- Channel keys are aligned: **CH+ / D-pad UP** = next channel, **CH- / D-pad DOWN** = previous channel.
- Source tests use a 3 s per-request / 6 s total timeout, so slow IPTV gateways are not marked dead too early.
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
- Number-key zapping, favourites, aspect ratio, native / hls.js decoder switch, remembers the last channel
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
- Through [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel) / [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop) from the webosbrew repository, or
- Download the IPK from [Releases](https://github.com/clowntreffen/qoder-iptv/releases) and install it with `ares-install --device tv <file>.ipk`.

## License
[MIT](LICENSE). Bundled third-party software: hls.js (Apache License 2.0); see [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt).
