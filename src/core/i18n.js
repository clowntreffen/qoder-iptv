


const DICT = {
  en: {
    // Settings
    'settings.title': 'Settings',
    'settings.aspect': 'Aspect Ratio',
    'settings.decoder': 'Decoder',
    'settings.autoPlay': 'Auto-play last channel on start',
    'settings.netSpeed': 'Show network speed',
    'settings.fontScale': 'Font Size',
    'settings.language': 'Language',
    'settings.audio': 'Audio Track',
    'settings.subtitles': 'Subtitles',
    'settings.sleep': 'Sleep Timer',
    'settings.autoRefresh': 'Auto-refresh sources & EPG',
    'settings.setPin': 'Set Parental PIN',
    'settings.changePin': 'Change Parental PIN',
    'settings.clearPin': 'Clear Parental PIN',
    'settings.appLock': 'PIN Lock on Start',
    'settings.backup': 'Back Up Settings',
    'settings.restore': 'Restore Settings',

    // Search
    'search.title': 'Search Channels',
    'search.placeholder': 'Channel name, group, or number',
    'search.count': '{n} channels found',
    'search.hint': 'Up/Down to select, OK to play, Back to close. Use the TV keyboard or mouse to type.',
    'search.empty': 'No matching channels',

    // PIN / Backup
    'pin.title': 'Enter PIN',
    'pin.prompt': 'Enter your 4-digit PIN',
    'pin.wrong': 'Wrong PIN, try again',
    'pin.cancel': 'Cancel',
    'pin.ok': 'OK',
    'pin.newTitle': 'Set Parental PIN',
    'pin.newPrompt': 'Enter a new 4-digit PIN',
    'pin.confirmTitle': 'Confirm PIN',
    'pin.confirmPrompt': 'Enter the 4-digit PIN again',
    'pin.clearTitle': 'Clear Parental PIN',
    'pin.lockTitle': 'App Locked',
    'pin.lockPrompt': 'Enter PIN to unlock',
    'backup.title': 'Back Up Settings',
    'backup.restoreTitle': 'Restore Settings',
    'backup.hint': 'This is the JSON backup of your current configuration. Copy and keep it safe.',
    'backup.restoreHint': 'Paste the backup JSON below, then choose Restore. The app reloads afterwards.',
    'backup.copy': 'Copy',
    'backup.restore': 'Restore',
    'backup.close': 'Close',
    'backup.footer': 'Left/Right to choose a button, OK to run, Back to close. The backup contains source URLs and settings; do not share it publicly.',
    'settings.refreshEpg': 'Refresh EPG',
    'settings.clearEpg': 'Clear EPG & Catch-up Cache',
    'settings.sourceManager': 'Live Source Manager',
    'settings.groupManager': 'Group Visibility',
    'settings.hint':
      'Up/Down to select, Left/Right to adjust, OK to run button items, Back to close.<br>Mouse: click a row to switch/run, click ◄ ► to adjust, click outside or ✕ to close.',
    'label.fill': 'Fill',
    'label.auto': 'Auto',
    'label.native': 'Native',
    'label.on': 'On',
    'label.off': 'Off',
    'label.small': 'Small',
    'label.medium': 'Medium',
    'label.large': 'Large',
    'label.minutes': '{n} min',

    // Player Tuning (hls.js)
    'settings.playerTuning': 'Player Tuning (on-device)',
    'settings.deviceInfo': 'Device Info',
    'startup.data': 'Data ',
    'startup.frame': 'Frame ',
    'startup.seek': 'Seek ',
    'startup.play': 'Play ',
    'startup.motion': 'Moving ',
    'startup.waitPlay': 'Wait ',
    'startup.ahead': 'Buffer {seconds}s',
    'startup.buffer': 'Waiting for playable data',
    'startup.seeking': 'Seeking',
    'startup.ready': 'Buffered, not advancing',
    'startup.dependency': 'Waiting for segment or audio',
    'startup.moving': 'Playback advancing',
    'startup.timeout': 'Startup observation ended',
    'startup.nudged': 'Adjusting start boundary',
    'startup.corrected': 'Start boundary adjusted',
    'startup.native': 'Native',
    'startup.nativeNudged': 'Adjusting native start position',
    'startup.nativeCorrected': 'Native startup nudge attempted',
    'startup.bufferUnknown': 'Native buffer not reported',
    'startup.error': 'Media error',
    'startup.fallback.media': 'media error',
    'startup.fallback.codec': 'codec error',
    'startup.fallback.hevc': 'HEVC unsupported by MSE',
    'startup.fallback.audio': 'audio unsupported by MSE',
    'tune.title': 'Player Tuning',
    'tune.reset': '↺ Reset All to Defaults',
    'tune.pathHls': 'Decoder: hls.js — prefetch buffer thresholds can be adjusted immediately',
    'tune.pathNative': 'Native decoder — hls.js settings have no effect; prefetch gating requires reported buffer data',
    'tune.pathIdle': 'Nothing playing — saved settings apply on next start',
    'tune.modified': 'Modified',
    'tune.allDefault': 'All at defaults',
    'tune.hint': 'Up/Down to select; Left/Right or arrows to adjust. Prefetch buffer settings apply instantly; other changes restart playback on close.',
    'tune.prefetchStartBuffer': 'Prefetch Start Buffer',
    'tune.prefetchStartBuffer.d': 'Continuous playback seconds required before starting or resuming neighbour downloads, not a fixed delay. Lower values allow earlier prefetch but compete more for bandwidth. With adaptive safety on, this is a minimum; see actual thresholds above.',
    'tune.prefetchHoldBuffer': 'Prefetch Pause Buffer',
    'tune.prefetchHoldBuffer.d': 'Below this buffer level, no new neighbour segment starts; in-flight downloads are kept. Must be lower than the start buffer and is reduced automatically if needed. Adaptive safety may raise this threshold.',
    'tune.prefetchAdaptive': 'Adaptive Prefetch Safety',
    'tune.prefetchAdaptive.d': 'On: raise thresholds using segment duration and download time; 6-second segments require at least 9 seconds of buffer. Off: use the two configured values exactly, allowing earlier prefetch at greater stall risk. Stalls still block new prefetch tasks.',
    'tune.prefetchStatus': 'Buffered {ahead}s · Prefetch start ≥{resume}s / pause <{hold}s',
    'tune.prefetchIdle': 'Actual thresholds appear during playback. The three prefetch buffer settings apply instantly.',
    'toast.tuningApplied': 'Tuning applied, restarting playback…',
    'toast.tuningReset': 'Defaults restored',
    'tune.liveSyncDuration': 'Live Edge Offset',
    'tune.liveSyncDuration.d':
      'How many seconds behind the live edge to start. Lower means less delay but a thinner buffer and more stalls; higher is steadier but further behind live.',
    'tune.startOnSegmentBoundary': 'Start on Segment Boundary',
    'tune.startOnSegmentBoundary.d':
      'On: start near the beginning of the first playable buffered range to reduce mid-segment seeking. Keyframes and audio/video timestamps still affect startup. Off: allow starting mid-segment.',
    'tune.prefetchSegmentBytes': 'Neighbour Prefetch Cap (per segment)',
    'tune.prefetchSegmentBytes.d':
      'Once the current buffer meets the prefetch threshold, 2 consecutive segments around the startup point of the previous/next channel are pulled into memory. Adjust start/pause buffers and adaptive safety below; zapping with CH+/- no longer downloads a segment — the player is told to start from a segment already in memory. Measured 0.4s startup on a hit versus 4s on a miss. The start point shifts back to the cached segment, but the first frame arrives earlier by about the same amount, so live latency is essentially unchanged. This is a PER-SEGMENT cap — anything bigger is skipped, so it must exceed your source\'s actual segment size or nothing gets cached (measured ~5-6MB here, so 8MB works). Watch the tag after the startup time in the speed badge: ⚡ = hit; after ✕ comes how many segments were held at zap time plus letters (b = segment over the cap, raise it; s = the cached segments have slid out of this channel\'s playlist window, you dwelled too long; w plus one more letter telling how far this channel\'s prefetch got: - never queued, you surfed past the immediate neighbours; 0 queued but no segment even started before the zap cleared the queue (you did not dwell long enough — a hard time wall: 2.4s per segment, so the first-queued direction is ready at ~2.6s and the other at ~5s, which is why the direction you last zapped in is prefetched first); a it was mid-download at zap time and got cancelled to yield bandwidth; e the request was rejected; b all segments over the cap; k downloaded and stored but the paths do not match; m the playlist could not be fetched). Background traffic is roughly 4× this value; if the current or the new channel gets slower instead, the prefetch is stealing bandwidth — set 0 to disable.',
    'tune.fragParallel': 'Parallel Segment Download',
    'tune.lanes': ' lanes',
    'tune.fragParallel.d':
      'Split each segment into parts and fetch them over several connections at once, then reassemble. Measured on these sources: the gateway caps a single connection at about 1.9x the programme bitrate while the line itself is far faster, so several connections together can saturate it. Measured on the TV: HD channels start in just over 1s instead of 3s+, and 4K channels in about 3s instead of 6s. This is also the real reason every channel takes about 3 seconds: at 1.9x the bitrate a 6-second segment always needs ~3 seconds, regardless of picture quality. Neighbour prefetch uses the same mechanism at half the lane count, so background prefetching does not crowd out the channel you are watching. More lanes use more of the line and more connections; the default of 6 comes from testing on the TV (4 to 6 still helped, 8 is untested — feel free to try). Falls back to a single whole-segment download when the source does not support ranged requests; set to Off if you suspect it causes artefacts or stalling.',
    'tune.maxBufferLength': 'Forward Buffer',
    'tune.maxBufferLength.d':
      'Target duration buffered ahead. Higher resists network jitter; playback does not wait for this entire buffer before starting.',
    'tune.backBufferLength': 'Back Buffer',
    'tune.backBufferLength.d': 'Seconds of played content kept. Lower it on low-memory devices.',
    'tune.abrEwmaDefaultEstimate': 'Initial Bandwidth Estimate',
    'tune.abrEwmaDefaultEstimate.d':
      'Assumed bandwidth at start. On multi-bitrate sources, a higher value picks HD right away; overestimating causes an immediate stall.',
    'tune.startFragPrefetch': 'Prefetch First Segment',
    'tune.startFragPrefetch.d': 'On: fetch the first segment without waiting for the decoder, starting faster.',
    'tune.fragLoadingTimeOut': 'Segment Timeout',
    'tune.fragLoadingTimeOut.d':
      'How long a segment download may take before timing out. Raise it for slow sources to avoid false failures.',
    'tune.fragLoadingMaxRetry': 'Segment Retries',
    'tune.fragLoadingMaxRetry.d':
      'Retry count after a failed segment download. Raise it on flaky sources to survive dropouts.',
    'tune.liveSyncOnStallIncrease': 'Buffer Bump on Stall',
    'tune.liveSyncOnStallIncrease.d':
      'Seconds added to the live edge offset after each stall, to avoid stalling repeatedly at the same spot.',
    'tune.enableWorker': 'Worker Demuxing',
    'tune.enableWorker.d':
      'On: demux on a background thread, keeping the UI smoother. Turn off if a device does not support it.',

    // Source Manager
    'sm.title': 'Live Source Manager',
    'sm.inUse': '(In Use)',
    'sm.testing': 'Testing…',
    'sm.test': '⟳ Test',
    'sm.delete': '✕ Delete',
    'sm.empty': 'No live sources yet. Add one above.',
    'sm.name': 'Name',
    'sm.m3uUrl': 'M3U URL',
    'sm.epgUrl': 'EPG URL (optional)',
    'sm.namePlaceholder': 'e.g. My IPTV',
    'sm.m3uPlaceholder': 'http://.../playlist.m3u',
    'sm.epgPlaceholder': 'Leave blank to use the URL in M3U, or built-in EPG',
    'sm.save': '＋ Save & Use',
    'sm.saved': 'Saved Sources',
    'sm.navigateHint': 'Up/Down: Name / M3U / EPG / Save. OK starts typing. EPG is optional.',
    'sm.inputHint': 'Typing: {field} · Arrows select keys, OK types a character. Keyboard Enter: next field. Back: finish typing.',
    'sm.hint':
      'After closing the keyboard, use Up/Down to revisit any field and OK to edit. Press OK on Save to save. Green to edit, Blue to delete, Back outside input to close.<br>Mouse: click a row to use, ✎ to edit, ⟳ to test, ✕ to delete, outside or top-right ✕ to close.',
    'sm.unnamed': 'Unnamed Source',
    'sm.pulling': 'Fetching source…',
    'sm.testingProgress': 'Testing {done}/{total}…',
    'sm.testDone': 'Done: kept {kept} channels, removed {dead} dead channels',
    'sm.testDoneGroups': ' (incl. {n} whole groups removed)',
    'sm.testFailed': 'Test failed: {msg}',
    'sm.noTestable': 'No testable channels in this source',
    'sm.netError': 'Network error',
    'sm.edit': '✎ Edit',
    'sm.saveEdit': '✓ Save Changes',
    'sm.editing': 'Editing: {name}',
    'sm.cancelEdit': 'Cancel',

    // Group Visibility
    'gm.title': 'Group Visibility',
    'gm.sub': 'Current source: {name} · {n}/{total} groups shown',
    'gm.rowShown': '{n} channels · Shown',
    'gm.rowHidden': '{n} channels · Hidden',
    'gm.showAll': '↺ Show All',
    'gm.keepOne': 'At least one group must stay visible',
    'gm.empty': 'No groups to manage in this source',
    'gm.hint':
      'Up/Down to select a group, OK (or Left/Right) to toggle shown/hidden, Back to close and apply.<br>Hidden groups are excluded from the channel menu and from Up/Down zapping; the setting applies to the current source only.',
    'toast.groupsApplied': 'Groups updated: {n} channels shown',
    'toast.groupsLocked': 'Parental locks updated: {n} groups locked',
    'toast.noGroups': 'No groups loaded for the current source yet',

    // Exit dialog
    'exit.title': 'Exit App',
    'exit.sub': 'Exit live TV and return to the TV home screen?',
    'exit.cancel': 'Cancel',
    'exit.exit': 'Exit',

    // catch-up resume
    'resume.title': 'Resume',
    'resume.message': 'You stopped at {position}. Resume?',
    'resume.resume': 'Resume',
    'resume.startOver': 'Start over',
    'resume.cancel': 'Cancel',

    // parental group locks
    'settings.groupLocks': 'Parental locks (groups)',
    'gm.lockTitle': 'Parental locks (groups)',
    'gm.lockSub': 'Locked groups ask for the parental PIN. Locked {n} / {total}',
    'gm.rowLocked': 'Locked ({n} channels)',
    'gm.rowUnlocked': 'Unlocked ({n} channels)',
    'gm.lockAll': 'Unlock all',
    'gm.lockHint': 'OK / ◄ ► toggle lock; Back saves',
    'gm.lockedBadge': 'Lock',
    'pin.groupTitle': 'Enter parental PIN',
    'pin.groupPrompt': 'This group is locked',
    'toast.noPinForLock': 'Set a parental PIN in Settings first',
    'toast.groupLocked': 'This group is locked',

    // channel customization
    'ce.title': 'Channel settings',
    'ce.current': 'Current: {name}',
    'ce.name': 'Name',
    'ce.nameHint': 'Type a new name',
    'ce.hidden': 'Hide channel',
    'ce.hiddenOn': 'Hidden',
    'ce.hiddenOff': 'Shown',
    'ce.epgOffset': 'EPG offset',
    'ce.offsetUnit': '{n} min',
    'ce.offsetZero': 'No offset',
    'ce.reset': 'Clear customization',
    'ce.hint': 'OK to change; ◄ ► offset; Back saves',
    'ce.enterHint': 'Type a name: OK saves, Back cancels',
    'toast.channelUpdated': 'Channel settings saved',
    'toast.channelReset': 'Restored source values',

    // toast
    'toast.noCatchup': 'Catch-up is not available for this programme',
    'toast.catchup': 'Catching up: {title}',
    'toast.catchupDetected': 'Catch-up enabled (last {span} available)',
    'unit.hours': '{n}h',
    'unit.days': '{n}d',
    'cu.probing': 'Checking catch-up…',
    'cu.ok': 'Catch-up: {span}',
    'cu.fail': 'No catch-up: {why} (rechecked when the guide opens)',
    'cu.why.live': 'live playlist {err}',
    'cu.why.nomatch': 'gateway has no timeshift',
    'cu.why.mcast': 'multicast relay has no timeshift',
    'cu.why.old': 'cached result',
    'cu.err.timeout': 'timed out',
    'cu.err.net': 'request failed',
    'cu.err.m3u': 'invalid',
    'cu.err.empty': 'empty',
    'cu.err.url': 'not http',
    'toast.backToLive': 'Back to live',
    'toast.sourceSwitch': 'Source {n}/{total}: {label}',
    'toast.channelNotFound': 'Channel {num} not found',
    'toast.noChannels': 'No channels parsed from this source',
    'toast.addSourceFirst': 'No playlist yet — add one first (enter a name and M3U URL, then save)',
    'toast.loadFailed': 'Load failed: {msg}',
    'toast.noEpgUrl': 'No EPG URL available',
    'toast.refreshingEpg': 'Refreshing EPG…',
    'toast.epgUpdated': 'EPG updated',
    'toast.epgFailed': 'EPG refresh failed',
    'toast.epgLoadFailed': 'EPG failed to load; no programme info',
    'toast.noEpgData': 'No EPG data loaded yet',
    'toast.faved': 'Favorited: {name}',
    'toast.unfaved': 'Removed from favorites',
    'toast.offline': 'Network disconnected',
    'toast.online': 'Network restored, reconnecting…',
    'toast.tryingBackup': 'Trying backup source {n}/{total}: {label}',
    'toast.channelUnavailable': 'This channel is currently unavailable',
    'toast.nativeOff': 'Native decoding paused, switched to compatibility mode',
    'toast.runtimeStalled': 'Playback stalled and no backup source is available',
    'toast.reminderAdded': 'Reminder set: {title} {time}',
    'toast.reminderRemoved': 'Reminder removed: {title}',
    'toast.reminderDue': 'Reminder: {title}',
    'toast.reminderDueGone': 'Reminder programme is no longer in the list: {title}',
    'toast.pinMismatch': 'PINs do not match, try again',
    'toast.pinSet': 'Parental PIN set',
    'toast.pinCleared': 'Parental PIN cleared',
    'toast.audioTrack': 'Audio: {label}',
    'toast.subtitleTrack': 'Subtitles: {label}',
    'toast.sleepEnd': 'Sleep timer reached, exiting',
    'toast.backupCopied': 'Backup copied to clipboard',
    'toast.backupCopyFailed': 'Could not copy; select the text manually',
    'toast.restoreDone': 'Settings restored, reloading',
    'toast.restoreFailed': 'Restore failed: invalid backup',

    // fetch errors
    'err.timeout':
      'Request timed out; the server did not respond. The origin may be too slow, or the TV is stuck on a dead IPv6 route',
    'err.httpRejected': '{msg}; the server rejected the request',
    'err.connBase': 'Cannot reach this URL. Check: whether it is dead or mistyped',
    'err.connHttps':
      '; three common HTTPS causes: certificate not trusted by the TV, DNS failure, or a dead IPv6 route. Try an http:// URL, disabling IPv6, or DNS 223.5.5.5',
    'err.connOther': '; and whether the TV network is working',

    // group hint
    'hint.group': 'Group',

    // Channel Menu
    'cm.favGroup': '★ Favorites',
    'cm.recentGroup': 'Recently Watched',
    'cm.favHint': 'Yellow / INFO / MENU: favorite focused channel',
    'cm.favEmpty': 'No favorites yet. Tap ☆ or press Yellow in the channel list.',
    'cm.favToggle': 'Favorite / unfavorite',
    'cm.channelHint': 'EPG / Catch-up ›',
    'cm.srcBadge': '{n} src',
    'cm.catchup': '⟲Catch-up',
    'cm.noEpg': 'No EPG data',
    'cm.settings': 'Settings',
    'cm.date': 'Date',
    'cm.epg': 'EPG',
    'cm.group': 'Groups',
    'cm.channels': 'Channels ({n})',
    'cm.groupChannels': '{g} ({n})',

    // EPG Guide
    'eg.catchup': '⟲Catch-up',
    'eg.noEpg': 'No EPG data for this day',
    'eg.title': 'EPG Guide',
    'eg.reminderBadge': '⏰ Reminder',
    'eg.reminderOn': 'Reminder set',
    'eg.reminderOff': 'No reminder',
    'eg.detailsEmpty': 'Select a programme for details',
    'eg.noDescription': 'No description available',
    'eg.detailsHint': 'Yellow / INFO: add or remove reminder',

    // Status Bar
    'sb.noSource': 'No source',
    'sb.channelCount': '{n} channels',
    'sb.online': '● Online',
    'sb.offline': '● Offline',

    // Catch-up Bar
    'cb.catchup': 'Catch-up',
    'cb.title': '⟲ Catch-up · {title}',
    'cb.speed': 'Speed',
    'cb.speedHint': '↑↓ progress/speed · ←→ adjust',
    'cb.speedFail': 'Speed unavailable ({reason}); playing at 1×',
    'rate.audio-codec': 'unsupported audio codec',
    'rate.audio-decode': 'audio decoding failed',
    'rate.audio-parse': 'audio data parse error',
    'rate.muxed': 'audio and video share one track',
    'rate.live': 'programme is still live',
    'rate.timescale': 'incompatible video timescale',
    'rate.no-video': 'no video track',
    'rate.media': 'decode error at speed',
    'rate.native': 'native decoder in use',
    'rate.no-mse': 'MSE unavailable',
    'rate.no-shim': 'browser engine unsupported',
    'rate.no-webaudio': 'Web Audio unavailable',
    'rate.detect': 'not supported on this device',

    // OSD
    'osd.catchup': 'Catch-up',
    'osd.nowPlaying': 'Now: {title} {time}',
    'osd.latency': 'Delay {s}s',
    'osd.nowPlayingNone': 'Now: no programme info',
    'osd.nextPlaying': 'Next: {title} {time}',
    'osd.source': '◀ Source {n}/{total}: {label} ▶',

    // Date / Weekday
    'date.today': 'Today',
    'date.tomorrow': 'Tomorrow',
    'date.yesterday': 'Yesterday',
    'date.weekFmt': '{d}',
    'date.week.0': 'Sun',
    'date.week.1': 'Mon',
    'date.week.2': 'Tue',
    'date.week.3': 'Wed',
    'date.week.4': 'Thu',
    'date.week.5': 'Fri',
    'date.week.6': 'Sat',

    // Audio codec labels
    'audio.dolbyPlus': 'Dolby+',
    'audio.dolby': 'Dolby',

    // Playback errors
    'perr.generic': 'Playback error',
    'perr.aborted': 'Playback aborted',
    'perr.network': 'Network error, unable to load',
    'perr.decode': 'Decode failed (unsupported format)',
    'perr.srcUnsupported': 'Source unavailable or format unsupported',
    'perr.hevcUnsupported': 'This channel is H.265/HEVC, not supported by this device',
    'perr.networkLost': 'Network interrupted, unable to load this channel',
    'perr.decodeFailed': 'Decoding keeps failing, cannot play this channel',
    'perr.playFailed': 'Playback failed: {detail}',
    'perr.unknown': 'Unknown error',

    // EPG programme
    'epg.unknownProgramme': 'Unknown programme',
    'group.ungrouped': 'Ungrouped',
    'label.system': 'System ({lang})',

    // Device Info
    'di.err.noBridge': 'Not running on webOS (normal in PC preview)',
    'di.err.timeout': 'Bridge did not respond (timeout)',
    'di.err.badJson': 'Response is not valid JSON',
    'di.err.callThrow': 'Call threw an exception',
    'di.err.unknownMethod': 'Method does not exist (wrong name)',
    'di.err.denied': 'Method exists but permission is denied',
    'di.err.notHandled': 'Permitted, but the parameters are wrong (can retry)',
    'di.noProbes': 'No probe records',
    'di.detecting': 'Detecting…',
    'di.failed': 'Detection failed',
    'di.serial': 'Serial Number',
    'di.wiredMac': 'Wired MAC',
    'di.wifiMac': 'Wi-Fi MAC',
    'di.macFailed': 'MAC lookup failed',
    'di.model': 'Model',
    'di.firmware': 'Firmware',
    'di.sysFailed': 'System info lookup failed',
    'di.appVersion': 'App Version',
    'di.hevcCaps': 'MSE HEVC decode',
    'di.curCodec': 'Current channel codec',
    'di.noChannel': 'Not playing',
    'di.pathHls': 'hls.js',
    'di.pathNative': 'native',
    'di.openSource': 'Open Source',
    'di.again': '↻ Detect Again',
    'di.rawShow': '▼ Raw Output',
    'di.rawHide': '▲ Hide Raw Output',
    'di.hint': 'Left/Right to choose a button, OK to run, Up/Down to scroll, Back to close.',

    // Speed badge diagnostics
    'ns.align.nowin': 'Playlist slid; cached segments outside window',
    'ns.align.ok': 'Aligned but missed (start position changed)',
    'ns.align.nodet': 'No segment list',
    'ns.align.old': 'Cached segments too old to align',
    'ns.align.off': 'Prefetch cap is 0',
    'ns.align.err': 'Alignment threw an error',
    'ns.alignCode': 'Align {code}',
    'ns.noAlign': 'Alignment not run',
    'ns.est': 'est. prefetch {warm}, own {own}',
    'ns.guess': ' (guess)',
    'ns.takeover': 'In-flight prefetch segment taken over ({age}ms downloaded)',
    'ns.giveUp': 'Gave up in-flight prefetch segment after {budget}ms',
    'ns.noCache': 'No cached segments for this channel · window {lo}~{hi} ({n} segs)',
    'ns.inWinMiss': 'In window but unmatched (URL rule)',
    'ns.slidOut': 'Cached segments slid out of window',
    'ns.window': '{why} · window {lo}~{hi} ({n} segs), cached {seg}',
    'ns.stale': '{align} · only unrelated stale segments cached (want {want}, have {top})',
    'ns.seg': '{align} · want {want}, have {top}',
    'ns.phase': 'Playlist {manifest} · First seg {frag} · Buffer {buffer} · '
  }
};


const UNGROUPED = 'Ungrouped';
const UNGROUPED_LEGACY = '\u672a\u5206\u7ec4';


const lang = 'en';

export function resolveLang() {
  return lang;
}

export function getLang() {
  return lang;
}

export function getLangPref() {
  return lang;
}


export function setLang() {
  return false;
}

export function groupLabel(name) {
  return name === UNGROUPED || name === UNGROUPED_LEGACY ? t('group.ungrouped') : name;
}



export function t(key, params) {
  const table = DICT[lang] || DICT.en;
  let s = table[key];
  if (s == null) s = key;
  if (params) {
    for (const k in params) {
      
      
      const ph = '{' + k + '}';
      if (s.indexOf(ph) >= 0) s = s.split(ph).join(params[k]);
    }
  }
  return s;
}
