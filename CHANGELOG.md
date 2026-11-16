# Changelog - Qoder IPTV fork

Based on [HCLGitHub/qoder-iptv](https://github.com/HCLGitHub/qoder-iptv) (MIT).

## 1.1.61
- Added a runtime stall watchdog: playback that stops advancing without an error automatically switches to the next source after 15 seconds.
- Dead source URLs discovered by the source test now expire after 12 hours instead of staying blacklisted forever.
- Added optional auto-refresh for M3U playlists (6 h) and EPG data (2 h), plus offline fallback to the last cached playlist, XMLTV data and DIYP day data.
- Added channel search (`Blue` in the channel menu) with name, group and channel-number matching, and a **Recently Watched** group in the channel menu.
- Added EPG programme details and reminders in the full-screen guide (`Yellow` or `INFO` to toggle a reminder).
- Added audio-track and subtitle-track selection to Settings.
- Added a parental PIN with optional PIN lock on startup, a sleep timer, and JSON settings backup/restore with clipboard support.
- Settings now show the selected subtitle correctly when non-subtitle text tracks exist.

## 1.1.60
- README now documents all fork changes and links the fork IPK download.
- Install documentation uses [Glasshouse](https://github.com/rorygallagher2024/glasshouse) instead of Homebrew Channel.
- D-pad direction changed: `UP` = next channel, `DOWN` = previous channel (CH+ / CH- already use next / previous).
- Removed the long-press OK favourite shortcut; Yellow, INFO/MENU and the clickable ☆/★ remain.
- README reduced to English only.

## 1.1.59
- Removed the long-press OK favourite shortcut from live TV.
- Favourites still work with Yellow, INFO/MENU and the clickable ☆/★ in the channel list.

## 1.1.58
- Favourites are always visible as the first group in the channel menu.
- Favourite toggles: Yellow in live TV and in the channel list, INFO/MENU where available, and a clickable ☆/★ next to each channel.
- Added `requiredACG: []` to app metadata.
- Fixed the webOS packager segfault by disabling broken native ssh2/cpu-features addons during packaging.

## 1.1.57
- Rebranded the app as **Qoder IPTV** with a new textless purple/blue TV-play icon and an English app description.
- Channel keys aligned: `CH+` = next/higher channel, `CH-` = previous channel.
- Source liveness check waits longer before marking a source dead: **3 s per request / 6 s total** (was 1.2 s / 2.5 s), so slow IPTV gateways are not falsely marked dead.
- Packaging now targets **Node.js 20+** (`.nvmrc` = 22); README remote-key table updated for the LG C5/MR25GA Magic Remote.

## Base
- Forked from HCLGitHub/qoder-iptv at commit `0a051c6` (upstream `v1.1.56`).
