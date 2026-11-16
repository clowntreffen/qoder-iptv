# Changelog - Qoder IPTV fork

Based on [HCLGitHub/qoder-iptv](https://github.com/HCLGitHub/qoder-iptv) (MIT).

## 1.1.66
- Removed the remaining Chinese characters from the repository: source, comments, tests, docs, logs and generator output are now English-only.
- Translated the last Chinese test names and assertion messages to English.
- Chinese channel-name patterns that are still required to match real IPTV playlists are stored as Unicode escapes, so EPG normalization for Chinese channels keeps working without Chinese glyphs in the tree.
- Fixed the dev-server config and the warm-gate test harness after the cleanup.

## 1.1.65
- Added per-channel customization: press `MENU` on a channel to rename it, hide it, shift its EPG by up to ±120 minutes, or clear the customization. Renames/hides/offsets survive source refreshes; hidden channels are skipped by zapping, search and the guide but stay listed (marked) in the channel menu so they can be restored.
- The UI is now fixed to English: the Chinese dictionary, language setting and locale-based switching were removed, and existing settings migrate to English.

## 1.1.64
- Added parental group locks: choose groups under Settings → Parental locks. Entering a locked group asks for the parental PIN (kept until the app restarts), and locked groups are skipped by CH+/CH-, number entry, search and the guide while staying listed with a lock badge.

## 1.1.63
- Catch-up now remembers where you stopped: leaving or switching away saves the position, and opening the same programme again asks to resume, start over, or cancel.
- A saved position is dropped automatically once the programme is nearly finished, so it cannot offer a resume at the very end.

## 1.1.62
- Fixed channel zapping inside the favourites group: CH+/CH- now stays among favourites until a non-favourite is selected, and rapid zapping keeps that context.
- Parental PIN is now stored as a salted SHA-256 hash (legacy plaintext PINs migrate on startup); changing an existing PIN requires the old PIN, and backups no longer contain it.
- Fixed M3U parsing when quoted attributes contain commas (`group-title="News, Sport"`).
- Escaped Settings values and the StatusBar source name to prevent HTML injection from malicious playlist names.
- Removed URL query/fragment credentials from console logs.
- Dev server now binds to `127.0.0.1` by default; self-signed upstream certificates require `VITE_PROXY_ALLOW_SELF_SIGNED=1`.
- Exit confirmation defaults to "Cancel" so a stray OK press cannot close the app.

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
