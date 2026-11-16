# Changelog - Qoder IPTV fork

Based on [HCLGitHub/qoder-iptv](https://github.com/HCLGitHub/qoder-iptv) (MIT).

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
