
import { KEY, digitOf } from './core/keys.js';
import { fetchM3U, applyActiveSource, renumberChannels, groupChannels } from './core/m3uParser.js';
import { epgStore } from './core/epgStore.js';
import { buildCatchupUrl, probeCatchup } from './core/catchup.js';
import {
  getSources,
  saveSources,
  getActiveSourceId,
  setActiveSourceId,
  getSettings,
  saveSettings,
  toggleFavorite,
  isFavorite,
  favVersion,
  getLastChannelKey,
  setLastChannelKey,
  getLastSourceIdx,
  setLastSourceIdx,
  getCatchupProbe,
  setCatchupProbe,
  recordRecent,
  getResumePosition,
  setResumePosition,
  removeResumePosition,
  getLockedGroups,
  setLockedGroups,
  getChannelOverrides
} from './core/storage.js';
import { applyChannelOverrides, getOverride, orderChannels, sortGroup } from './core/channelCustomization.js';
import { DEFAULT_THEME, isValidTheme } from './core/themes.js';
import { activeDeadUrls } from './core/deadUrls.js';
import { StallWatchdog } from './core/stallWatchdog.js';
import { takeDueReminders } from './core/reminders.js';
import { backupText, restoreBackup } from './core/backup.js';
import { hashPin, migratePin, verifyPin as verifyPinHash } from './core/pin.js';
import { esc } from './core/util.js';
import { t, getLang, groupLabel } from './core/i18n.js';
import { Player } from './player/Player.js';
import { Osd } from './player/osd.js';
import { StatusBar } from './ui/StatusBar.js';
import { ChannelMenu } from './ui/ChannelMenu.js';
import { EpgGuide } from './ui/EpgGuide.js';
import { Settings } from './ui/Settings.js';
import { SourceManager } from './ui/SourceManager.js';
import { GroupManager } from './ui/GroupManager.js';
import { PlayerTuning } from './ui/PlayerTuning.js';
import { DeviceInfo } from './ui/DeviceInfo.js';
import { CatchupBar } from './ui/CatchupBar.js';
import { ResumePrompt } from './ui/ResumePrompt.js';
import { NetSpeed } from './ui/NetSpeed.js';
import { Search } from './ui/Search.js';
import { PinEntry } from './ui/PinEntry.js';
import { BackupDialog } from './ui/BackupDialog.js';
import { ChannelEditor } from './ui/ChannelEditor.js';

const $ = (id) => document.getElementById(id);

const app = {
  channels: [], 
  allChannels: [], 
  channelsAll: [], 
  allGroups: [], 
  current: null, 
  source: null, 
  settings: getSettings(),
  zapMode: 'all', 
  lockedGroups: new Set(getLockedGroups()), 
  unlockedGroups: new Set(), 
  groupLockVersion: 0, 
  numBuffer: '',
  numTimer: null
};


let sourceLoadId = 0;


const player = new Player($('video'));
const osd = new Osd($('osd'));
const statusBar = new StatusBar($('status-bar'));
const channelMenu = new ChannelMenu($('channel-menu'));
const epgGuide = new EpgGuide($('epg-guide'));
const settings = new Settings($('settings'));
const sourceManager = new SourceManager($('source-manager'));
const groupManager = new GroupManager($('group-manager'));
const playerTuning = new PlayerTuning($('player-tuning'));
const deviceInfo = new DeviceInfo($('device-info'), player);
const catchupBar = new CatchupBar($('catchup-bar'), player, $('speed-badge'));
const resumePrompt = new ResumePrompt($('resume-prompt'));
const netSpeed = new NetSpeed($('net-speed'), player);
const search = new Search($('search'));
const pinEntry = new PinEntry($('pin-entry'));
const backupDialog = new BackupDialog($('backup-dialog'));
const channelEditor = new ChannelEditor($('channel-editor'));


function toast(msg, ms = 2600) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), ms);
}
function loading(show) {
  $('loading').classList.toggle('hidden', !show);
}



let exitDialogOpen = false;
let exitFocus = 0; 

function renderExitDialog() {
  $('exit-dialog').innerHTML = `
    <div class="exit-box">
      <div class="exit-title">${t('exit.title')}</div>
      <div class="exit-sub">${t('exit.sub')}</div>
      <div class="exit-btns">
        <div class="exit-btn${exitFocus === 0 ? ' focused' : ''}" data-action="cancel">${t('exit.cancel')}</div>
        <div class="exit-btn danger${exitFocus === 1 ? ' focused' : ''}" data-action="exit">${t('exit.exit')}</div>
      </div>
    </div>`;
}

function openExitDialog() {
  exitDialogOpen = true;
  exitFocus = 0; 
  renderExitDialog();
  $('exit-dialog').classList.remove('hidden');
}

function closeExitDialog() {
  exitDialogOpen = false;
  $('exit-dialog').classList.add('hidden');
}


function exitApp() {
  closeExitDialog();
  try {
    if (window.webOSSystem && typeof window.webOSSystem.close === 'function') {
      window.webOSSystem.close();
      return;
    }
    if (window.PalmSystem && typeof window.PalmSystem.deactivate === 'function') {
      window.PalmSystem.deactivate();
      return;
    }
  } catch (e) {}
  try { window.close(); } catch (e) {}
}

function handleExitKey(code) {
  switch (code) {
    case KEY.LEFT:
    case KEY.RIGHT:
      exitFocus = exitFocus === 0 ? 1 : 0;
      renderExitDialog();
      break;
    case KEY.OK:
      if (exitFocus === 1) exitApp();
      else closeExitDialog();
      break;
    case KEY.BACK:
      closeExitDialog();
      break;
    default:
      break;
  }
  return true; 
}




let zapStarting = false;
let zapStartAt = 0; 
let stallTimer = null;
let startWatchdog = null; 
let failoverCount = 0; 
const START_TIMEOUT_MS = 12000; 
const runtimeStall = new StallWatchdog({
  getPosition: () => (player.video && player.video.currentTime) || 0,
  isActive: () => !!app.current && !player.isCatchup() && !document.hidden &&
    !player.video.paused && !player.video.ended && !player.video.error,
  onStall: () => handleRuntimeStall()
});

function beginLoading(preserveStart = false) {
  zapStarting = true;
  if (typeof runtimeStall !== 'undefined') runtimeStall.stop();
  if (!preserveStart || !zapStartAt) zapStartAt = Date.now();
  clearTimeout(stallTimer);
  stallTimer = null;
  clearTimeout(startWatchdog);
  startWatchdog = setTimeout(onStartTimeout, START_TIMEOUT_MS);
  loading(true);
  netSpeed.reset(); 
}

function endLoading() {
  zapStarting = false;
  if (typeof runtimeStall !== 'undefined') runtimeStall.stop();
  clearTimeout(stallTimer);
  stallTimer = null;
  clearTimeout(startWatchdog);
  startWatchdog = null;
  loading(false);
}


function onStartTimeout() {
  startWatchdog = null;
  if (player.video.paused && player.video.readyState >= 2 && !player.video.error) {
    startWatchdog = setTimeout(onStartTimeout, START_TIMEOUT_MS);
    return;
  }
  if (tryFailover()) return;
  zapStarting = false;
  clearTimeout(stallTimer);
  stallTimer = null;
  loading(false);
  toast(t('toast.channelUnavailable'), 4000);
}


function tryFailover() {
  const ch = app.current;
  if (player.isCatchup() || !ch || !ch.sources || ch.sources.length < 2) return false;
  if (failoverCount >= ch.sources.length - 1) return false;
  failoverCount++;
  ch.sourceIdx = (ch.sourceIdx + 1) % ch.sources.length;
  applyActiveSource(ch);
  liveStartAt = Date.now();
  beginLoading();
  player.playLive(ch, app.settings.decoder);
  schedulePrefetch();
  toast(t('toast.tryingBackup', {
    n: ch.sourceIdx + 1,
    total: ch.sources.length,
    label: ch.sources[ch.sourceIdx].label
  }), 2500);
  return true;
}

function handleRuntimeStall() {
  if (player.isCatchup() || !app.current) return;
  if (tryFailover()) return;
  loading(false);
  toast(t('toast.runtimeStalled'), 4000);
}


function anyOverlayOpen() {
  return (
    channelMenu.isOpen() ||
    channelEditor.isOpen() ||
    epgGuide.isOpen() ||
    settings.isOpen() ||
    sourceManager.isOpen() ||
    groupManager.isOpen() ||
    playerTuning.isOpen() ||
    deviceInfo.isOpen() ||
    search.isOpen() ||
    backupDialog.isOpen() ||
    pinEntry.isOpen()
  );
}


let liveStartAt = 0; 





function isPlayingLive(ch) {
  if (!ch || !ch.url) return false;
  if (player.isCatchup()) return false; 
  const cur = player.current;
  if (!cur || cur.url !== ch.url) return false; 
  const v = player.video;
  if (!v || v.error) return false; 
  
  if (v.readyState === 0 && Date.now() - liveStartAt > 8000) return false;
  return true;
}


function useRememberedSource(ch) {
  if (!ch || !ch.sources || ch.sources.length < 2) return;
  const idx = getLastSourceIdx(ch.key);
  if (idx <= 0 || idx >= ch.sources.length) return;
  ch.sourceIdx = idx;
  applyActiveSource(ch);
}


function rememberPlayingSource() {
  const ch = app.current;
  if (!ch || player.isCatchup()) return;
  recordRecent(ch.key);
  if (!ch.sources || ch.sources.length < 2) return;
  if (getLastSourceIdx(ch.key) === ch.sourceIdx) return;
  setLastSourceIdx(ch.key, ch.sourceIdx);
}


// (Vor allem beim „Zurück zu Live“ sowie bei Source/Group-Wechsel.)
function rememberResumeIfCatchup() {
  if (!player.isCatchup() || !app.current) return;
  const key = app.current.key;
  const pos = player.position();
  if (!(pos > 0)) { removeResumePosition(key); return; }
  const dur = player.video && isFinite(player.video.duration) ? player.video.duration : 0;
  if (dur > 0 && pos >= dur - 5) { removeResumePosition(key); return; }
  setResumePosition(key, pos);
}




function playLive(ch, delay = 0, mode = 'all') {
  if (!ch) return;
  clearTimeout(playLive._t);
  rememberResumeIfCatchup();
  app.zapMode = mode;

  
  
  if (isPlayingLive(ch)) {
    app.current = ch;
    osd.show(ch);
    return;
  }

  app.current = ch;
  useRememberedSource(ch);
  setLastChannelKey(ch.key);
  catchupBar.close();
  osd.show(ch);

  const start = () => {
    playLive._t = null;
    failoverCount = 0; 
    runtimeStall.reset();
    liveStartAt = Date.now();
    beginLoading();
    player.playLive(ch, app.settings.decoder);
    schedulePrefetch();
  };
  if (delay > 0) playLive._t = setTimeout(start, delay);
  else start();
}


function playCatchup(ch, programme) {
  const url = buildCatchupUrl(ch, programme);
  if (!url) {
    toast(t('toast.noCatchup'));
    return;
  }
  const saved = getResumePosition(ch.key);
  const dur = programme && programme.start && programme.stop && !isNaN(programme.stop)
    ? (programme.stop - programme.start) / 1000
    : 0;
  if (saved > 0) {
    if (!dur || saved < dur - 10) {
      resumePrompt.show({
        title: programme.title,
        position: saved,
        onResume: () => startCatchup(ch, programme, url, saved),
        onStartOver: () => {
          removeResumePosition(ch.key);
          startCatchup(ch, programme, url, 0);
        },
        onCancel: () => {}
      });
      return;
    }
    removeResumePosition(ch.key);
  }
  startCatchup(ch, programme, url, 0);
}

function startCatchup(ch, programme, url, resumeAt) {
  app.current = ch;
  player.playCatchup(ch, programme, url, app.settings.decoder, resumeAt);
  beginLoading();
  catchupBar.show(programme);
  toast(t('toast.catchup', { title: programme.title }), 3000);
}

function returnToLive() {
  if (player.isCatchup() && app.current) {
    playLive(app.current, 0, app.zapMode);
    toast(t('toast.backToLive'));
  }
}



function schedulePrefetch() {
  player.holdWarm();
  prefetchNeighbors();
}

function prefetchNeighbors() {
  const list = zapList();
  if (!list.length || !app.current) return;
  const idx = list.findIndex((c) => c.key === app.current.key);
  if (idx < 0) return;
  const next = list[(idx + 1) % list.length];
  const prev = list[(idx - 1 + list.length) % list.length];
  try {
    console.log('[warm] neighbours of ' + app.current.name + ': ' + next.name + ' / ' + prev.name);
  } catch (e) {}
  
  
  const forward = lastZapDir >= 0;
  const first = forward ? next : prev;
  const second = forward ? prev : next;
  player.prefetch(first.url, false, first.headers);
  player.prefetch(second.url, false, second.headers);
}


let lastZapDir = 1;




function zapOrder() {
  if (zapOrder._src === app.channels && zapOrder._lockVer === app.groupLockVersion && zapOrder._list) {
    return zapOrder._list;
  }
  const map = new Map();
  for (const ch of app.channels) {
    if (!isGroupUnlocked(ch.group)) continue; 
    if (!map.has(ch.group)) map.set(ch.group, []);
    map.get(ch.group).push(ch);
  }
  const list = [];
  for (const arr of map.values()) list.push(...arr);
  zapOrder._src = app.channels;
  zapOrder._lockVer = app.groupLockVersion;
  zapOrder._list = list;
  return list;
}


function favZapOrder() {
  const base = zapOrder();
  if (favZapOrder._src !== base || favZapOrder._favVer !== favVersion() || !favZapOrder._list) {
    favZapOrder._src = base;
    favZapOrder._favVer = favVersion();
    favZapOrder._list = base.filter((c) => isFavorite(c.key));
  }
  return favZapOrder._list;
}


function zapList() {
  return app.zapMode === 'fav' ? favZapOrder() : zapOrder();
}


function showGroupHint(name) {
  if (!name) return;
  const el = $('group-hint');
  el.innerHTML = `<span class="gh-label">${t('hint.group')}</span><span>${esc(groupLabel(name))}</span>`;
  el.classList.remove('hidden');
  clearTimeout(showGroupHint._t);
  showGroupHint._t = setTimeout(() => el.classList.add('hidden'), 2000);
}



function switchByOffset(delta) {
  let list = zapList();
  
  if (app.zapMode === 'fav' &&
      (!list.length || !list.some((c) => c.key === (app.current && app.current.key)))) {
    app.zapMode = 'all';
    list = zapOrder();
  }
  if (!list.length) return;
  lastZapDir = delta >= 0 ? 1 : -1; 
  let idx = list.findIndex((c) => c.key === (app.current && app.current.key));
  if (idx < 0) idx = 0;
  idx = (idx + delta + list.length) % list.length;
  const next = list[idx];
  
  if (app.zapMode !== 'fav' && (!app.current || app.current.group !== next.group)) {
    showGroupHint(next.group);
  }
  
  
  const now = Date.now();
  const rapid = now - (switchByOffset._last || 0) < 500;
  switchByOffset._last = now;
  
  playLive(next, rapid ? 300 : 0, app.zapMode);
}


function switchSource(delta) {
  const ch = app.current;
  if (!ch || !ch.sources || ch.sources.length < 2) return false;
  failoverCount = 0; 
  runtimeStall.reset();
  ch.sourceIdx = (ch.sourceIdx + delta + ch.sources.length) % ch.sources.length;
  applyActiveSource(ch);
  setLastChannelKey(ch.key);
  liveStartAt = Date.now();
  beginLoading();
  player.playLive(ch, app.settings.decoder);
  osd.show(ch);
  toast(t('toast.sourceSwitch', { n: ch.sourceIdx + 1, total: ch.sources.length, label: ch.sources[ch.sourceIdx].label }));
  return true;
}


function pushDigit(d) {
  app.numBuffer += String(d);
  const el = $('channel-input');
  el.textContent = app.numBuffer;
  el.classList.remove('hidden');
  clearTimeout(app.numTimer);
  app.numTimer = setTimeout(() => commitNumber(), 2000);
}
function commitNumber() {
  clearTimeout(app.numTimer);
  const n = parseInt(app.numBuffer, 10);
  app.numBuffer = '';
  $('channel-input').classList.add('hidden');
  if (!n) return;
  
  const ch =
    app.channels.find((c) => String(c.chno) === String(n)) ||
    app.channels.find((c) => c.index === n);
  if (ch) {
    if (!isGroupUnlocked(ch.group)) {
      toast(t('toast.groupLocked'));
      return;
    }
    playLive(ch);
  } else toast(t('toast.channelNotFound', { num: n }));
}





function filterVisibleGroups(channels, hiddenGroups) {
  const hidden = new Set(hiddenGroups || []);
  const visible = hidden.size ? channels.filter((ch) => !hidden.has(ch.group)) : channels;
  if (hidden.size && !visible.length) {
    renumberChannels(channels);
    return channels;
  }
  renumberChannels(visible);
  return visible;
}




function rebuildChannelLists() {
  const src = app.source;
  const groupVisible = filterVisibleGroups(app.allChannels, src ? src.hiddenGroups : []);
  app.channelsAll = groupVisible;
  app.channels = groupVisible.filter((ch) => !ch.customHidden);
  
  renumberChannels(app.channels);
}


function applyGroupVisibility(hiddenArr) {
  const src = app.source;
  if (!src) return;
  src.hiddenGroups = hiddenArr;
  
  const list = getSources();
  const item = list.find((s) => s.id === src.id);
  if (item) {
    item.hiddenGroups = hiddenArr;
    saveSources(list);
  }
  rebuildChannelLists();
  const visible = app.channels;
  statusBar.setSource(src.name, visible.length);
  statusBar.show(5000);
  
  if (app.current && !visible.some((c) => c.key === app.current.key)) {
    if (visible.length) playLive(visible[0]);
  }
  toast(t('toast.groupsApplied', { n: visible.length }));
}


function isGroupUnlocked(name) {
  if (!app.lockedGroups.has(name)) return true;
  return app.unlockedGroups.has(name);
}


function visibleChannelsForMenu() {
  return (app.channelsAll || app.channels).filter((c) => isGroupUnlocked(c.group));
}

function applyGroupLocks(names) {
  app.lockedGroups = new Set(names || []);
  app.groupLockVersion++;
  setLockedGroups([...app.lockedGroups]);
  toast(t('toast.groupsLocked', { n: app.lockedGroups.size }));
}

async function loadSource(src, options = {}) {
  if (!src) return;
  const silent = !!options.silent;
  const loadId = ++sourceLoadId;
  app.source = src;
  app.zapMode = 'all';
  
  if (!silent) {
    epgStore.clear();
    loading(true);
  }
  try {
    const { epgUrl, channels: parsed } = await fetchM3U(src.m3uUrl);
    if (loadId !== sourceLoadId) return;
    let channels = parsed;
    
    
    const deadUrls = activeDeadUrls(src);
    if (deadUrls.length) {
      const dead = new Set(deadUrls);
      channels = channels.filter((ch) => {
        ch.sources = ch.sources.filter((s) => !dead.has(s.url));
        if (!ch.sources.length) return false;
        ch.sourceIdx = 0;
        applyActiveSource(ch);
        return true;
      });
      
      renumberChannels(channels);
    }
    if (!channels.length) {
      if (!silent) {
        toast(t('toast.noChannels'));
        loading(false);
      }
      return;
    }
    applySourceCatchup(src, channels);
    
    const overrides = getChannelOverrides();
    applyChannelOverrides(channels, overrides);
    channels = orderChannels(channels, overrides);
    
    app.allChannels = channels;
    app.allGroups = groupChannels(channels).map((g) => ({ name: g.name, count: g.channels.length }));
    
    rebuildChannelLists();
    const visible = app.channels;
    statusBar.setSource(src.name, visible.length);

    if (silent) {
      const key = app.current && app.current.key;
      const same = key ? visible.find((c) => c.key === key) : null;
      if (same) {
        same.sourceIdx = app.current.sourceIdx || 0;
        applyActiveSource(same);
        app.current = same;
        if (osd.isVisible()) {
          osd.show(same, {
            catchup: player.isCatchup(),
            programme: player.current && player.current.programme
          });
        }
      } else if (visible.length && !app.current) {
        playLive(visible[0]);
      }
      return;
    }

    
    const finalEpg = src.epgUrl || epgUrl;
    const finalEpgType = src.epgType;
    if (finalEpg) {
      epgStore.load(finalEpg, finalEpgType).then((ok) => {
        if (loadId !== sourceLoadId || ok == null) return;
        if (ok) refreshVisible();
        else toast(t('toast.epgLoadFailed'));
      });
    }

    
    let target = null;
    if (app.settings.autoPlayLast) {
      const lastKey = getLastChannelKey();
      target = channels.find((c) => c.key === lastKey);
    }
    target = target || channels[0];
    loading(false);
    playLive(target);
    statusBar.show(5000);
  } catch (e) {
    if (loadId !== sourceLoadId || silent) return;
    loading(false);
    const msg = (e && e.message) || '';
    toast(t('toast.loadFailed', { msg: describeFetchError(msg, src.m3uUrl) }), 8000);
    
    
    sourceManager.open();
  }
}




function describeFetchError(msg, url) {
  if (/abort/i.test(msg)) return t('err.timeout');
  if (/HTTP\s*\d/i.test(msg)) return t('err.httpRejected', { msg });
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) {
    const base = t('err.connBase');
    return /^https:/i.test(url || '')
      ? base + t('err.connHttps')
      : base + t('err.connOther');
  }
  return msg || t('sm.netError');
}


function refreshVisible() {
  if (channelMenu.isOpen()) channelMenu.refreshEpg();
  if (epgGuide.isOpen()) epgGuide.refreshEpg();
  
  if (osd.isVisible() && app.current) {
    osd.show(app.current, {
      catchup: player.isCatchup(),
      programme: player.current && player.current.programme
    });
  }
}


epgStore.onUpdate = refreshVisible;


function applySettings(s) {
  app.settings = s;
  player.setAspect(s.aspect);
  netSpeed.setEnabled(!!s.showNetSpeed);
  document.documentElement.style.setProperty('--ui-zoom', s.fontScale || 1);
  document.documentElement.dataset.theme = isValidTheme(s.theme) ? s.theme : DEFAULT_THEME;
  setSleepTimer(s.sleepMinutes);
  scheduleAutoRefresh(!!s.autoRefresh);
  applyLanguage();
}


function applyLanguage() {
  document.documentElement.lang = getLang();
}


function fitScreen() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const s = Math.min(w / 1920, h / 1080) || 1;
  const x = Math.round((w - 1920 * s) / 2);
  const y = Math.round((h - 1080 * s) / 2);
  const appEl = document.getElementById('app');
  if (appEl) appEl.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
}
window.addEventListener('resize', fitScreen);
window.addEventListener('orientationchange', fitScreen);


function askPin({ title, prompt, onSubmit, onCancel }) {
  pinEntry.open({
    title: title || t('pin.title'),
    prompt: prompt || t('pin.prompt'),
    onSubmit,
    onCancel
  });
}

function verifyPin(pin) {
  const expected = app.settings.parentalPin || '';
  return !!expected && verifyPinHash(pin, expected);
}

function setHashedPin(pin) {
  const hashed = hashPin(pin);
  app.settings.parentalPin = hashed;
  saveSettings({ parentalPin: hashed });
}

function changePin() {
  
  const askNew = () => askPin({
    title: t('pin.newTitle'),
    prompt: t('pin.newPrompt'),
    onSubmit: (pin) => {
      setTimeout(() => {
        askPin({
          title: t('pin.confirmTitle'),
          prompt: t('pin.confirmPrompt'),
          onSubmit: (again) => {
            if (again !== pin) {
              toast(t('toast.pinMismatch'));
              return false;
            }
            setHashedPin(pin);
            toast(t('toast.pinSet'));
            syncSettingsPanel();
            return true;
          }
        });
      }, 0);
      return true;
    }
  });
  if (app.settings.parentalPin) {
    askPin({
      title: t('pin.title'),
      prompt: t('pin.prompt'),
      onSubmit: (pin) => {
        if (!verifyPin(pin)) return false;
        askNew();
        return true;
      }
    });
    return;
  }
  askNew();
}

function clearPin() {
  askPin({
    title: t('pin.clearTitle'),
    prompt: t('pin.prompt'),
    onSubmit: (pin) => {
      if (!verifyPin(pin)) return false;
      app.settings.parentalPin = '';
      app.settings.appLock = false;
      saveSettings({ parentalPin: '', appLock: false });
      toast(t('toast.pinCleared'));
      syncSettingsPanel();
      return true;
    }
  });
}

function syncSettingsPanel() {
  settings.s = getSettings();
  if (settings.isOpen()) settings.render();
}

function openBackup(mode) {
  backupDialog.open(mode, mode === 'restore' ? '' : backupText());
}

function trackLabels() {
  const state = player.getTrackState ? player.getTrackState() : null;
  if (!state) return {};
  const audio = state.audio && state.audio.length
    ? (state.audio[state.audioIndex] || state.audio[0]).label
    : t('label.auto');
  const current = state.subtitleIndex >= 0
    ? state.subtitles.find((track) => track.index === state.subtitleIndex)
    : null;
  const subtitle = current ? current.label : t('label.off');
  return { audio, subtitles: subtitle };
}

let sleepTimer = null;
let lastSleepMinutes = 0;
function setSleepTimer(minutes) {
  const n = Number(minutes) || 0;
  if (n === lastSleepMinutes) return;
  lastSleepMinutes = n;
  clearTimeout(sleepTimer);
  sleepTimer = null;
  if (n <= 0) return;
  sleepTimer = setTimeout(() => {
    sleepTimer = null;
    lastSleepMinutes = 0;
    app.settings.sleepMinutes = 0;
    saveSettings({ sleepMinutes: 0 });
    player.stop();
    toast(t('toast.sleepEnd'), 4000);
    setTimeout(exitApp, 1200);
  }, n * 60000);
}

let m3uRefreshTimer = null;
let epgRefreshTimer = null;
const M3U_REFRESH_MS = 6 * 3600 * 1000;
const EPG_REFRESH_MS = 2 * 3600 * 1000;

function refreshPlaylistSilently() {
  if (!app.source || document.hidden) return;
  loadSource(app.source, { silent: true });
}

function refreshEpgSilently() {
  if (!app.source || document.hidden) return;
  const url = app.source.epgUrl || epgStore.url;
  if (!url) return;
  epgStore.load(url, app.source.epgType || epgStore.mode, { force: true }).then((ok) => {
    if (ok) refreshVisible();
  });
}

function scheduleAutoRefresh(enabled) {
  clearInterval(m3uRefreshTimer);
  clearInterval(epgRefreshTimer);
  m3uRefreshTimer = null;
  epgRefreshTimer = null;
  if (!enabled) return;
  m3uRefreshTimer = setInterval(refreshPlaylistSilently, M3U_REFRESH_MS);
  epgRefreshTimer = setInterval(refreshEpgSilently, EPG_REFRESH_MS);
}

function checkReminders() {
  const due = takeDueReminders();
  for (const r of due) {
    const ch = app.channels.find((c) => c.key === r.channelKey);
    if (ch) {
      if (!player.isCatchup()) playLive(ch);
      toast(t('toast.reminderDue', { title: r.title || ch.name }), 6000);
    } else {
      toast(t('toast.reminderDueGone', { title: r.title || '' }), 6000);
    }
  }
  rememberResumeIfCatchup();
}
setInterval(checkReminders, 30000);


channelMenu.onPlayLive = (ch, opts) => playLive(ch, 0, opts && opts.zapMode);
channelMenu.onPlayCatchup = playCatchup;
channelMenu.onOpenSettings = () => settings.open();
channelMenu.onOpenSearch = (key) => search.open(app.channels, key);
channelMenu.onToast = toast;
channelMenu.isGroupUnlocked = (name) => isGroupUnlocked(name);

channelMenu.onRequestUnlock = (name, cb) => {
  if (!app.settings.parentalPin) {
    toast(t('toast.noPinForLock'));
    cb(false);
    return;
  }
  askPin({
    title: t('pin.groupTitle'),
    prompt: t('pin.groupPrompt'),
    onSubmit: (pin) => {
      if (!verifyPin(pin)) return false; 
      app.unlockedGroups.add(name);
      app.groupLockVersion++;
      cb(true);
      return true;
    },
    onCancel: () => cb(false)
  });
};
channelMenu.onProbeCatchup = probeChannelCatchup;
channelMenu.catchupNote = catchupNote;

channelMenu.onEditChannel = (ch) => {
  if (!ch) return;
  const map = getChannelOverrides();
  const siblings = sortGroup(app.allChannels.filter((c) => c.group === ch.group), map);
  const groups = [];
  for (const c of app.allChannels) if (!groups.includes(c.group)) groups.push(c.group);
  channelEditor.open(ch, { groups, siblings });
};

function refreshCustomization() {
  const map = getChannelOverrides();
  applyChannelOverrides(app.allChannels, map);
  app.allChannels = orderChannels(app.allChannels, map);
  rebuildChannelLists();
  if (app.current && osd.isVisible()) {
    osd.show(app.current, { catchup: player.isCatchup(), programme: player.current && player.current.programme });
  }
}

channelEditor.onChanged = () => {
  const key = channelEditor.ch && channelEditor.ch.key;
  refreshCustomization();
  // Keep the editor's sibling/group context in sync, so a second move or a
  // regroup acts on the channel's current group instead of the old one.
  if (channelEditor.ch) {
    const map = getChannelOverrides();
    const group = channelEditor.ch.group;
    channelEditor.siblings = sortGroup(app.allChannels.filter((c) => c.group === group), map);
    const groups = [];
    for (const c of app.allChannels) if (!groups.includes(c.group)) groups.push(c.group);
    channelEditor.groups = groups;
  }
  const hasOverride = key && getOverride(getChannelOverrides(), key);
  toast(hasOverride ? t('toast.channelUpdated') : t('toast.channelReset'));
  
  if (channelMenu.isOpen()) channelMenu.render();
};
channelEditor.onClose = () => {};

epgGuide.onPlayLive = playLive;
epgGuide.onPlayCatchup = playCatchup;
epgGuide.onProbeCatchup = probeChannelCatchup;
epgGuide.onToast = toast;

settings.onChange = (s) => applySettings(s);
settings.getTrackLabels = trackLabels;
settings.onCycleAudio = (dir) => {
  const state = player.cycleAudio(dir);
  const track = state.audio[state.audioIndex];
  if (track) toast(t('toast.audioTrack', { label: track.label }));
};
settings.onCycleSubtitle = (dir) => {
  const state = player.cycleSubtitle(dir);
  const track = state.subtitleIndex >= 0
    ? state.subtitles.find((item) => item.index === state.subtitleIndex)
    : null;
  toast(t('toast.subtitleTrack', { label: track ? track.label : t('label.off') }));
};
settings.onSetPin = changePin;
settings.onClearPin = clearPin;
settings.onBackup = () => openBackup('backup');
settings.onRestore = () => openBackup('restore');
settings.onRefreshEpg = () => {
  const url = (app.source && app.source.epgUrl) || epgStore.url;
  if (!url) { toast(t('toast.noEpgUrl')); return; }
  const type = (app.source && app.source.epgType) || epgStore.mode;
  toast(t('toast.refreshingEpg'));
  epgStore.load(url, type, { force: true }).then((ok) => {
    if (ok == null) return; 
    toast(ok ? t('toast.epgUpdated') : t('toast.epgFailed'));
    refreshVisible();
  });
};
settings.onOpenSources = () => sourceManager.open();
settings.onOpenGroups = () => {
  if (!app.allGroups.length) {
    toast(t('toast.noGroups'));
    return;
  }
  groupManager.open(
    app.allGroups,
    (app.source && app.source.hiddenGroups) || [],
    app.source && app.source.name
  );
};

sourceManager.onUseSource = (src) => loadSource(src);

groupManager.onApply = (names, mode) => {
  if (mode === 'lock') applyGroupLocks(names);
  else applyGroupVisibility(names);
};

settings.onOpenGroupLocks = () => {
  if (!app.allGroups.length) {
    toast(t('toast.noGroups'));
    return;
  }
  groupManager.open(
    app.allGroups,
    [...app.lockedGroups],
    app.source && app.source.name,
    'lock'
  );
};

settings.onOpenTuning = () => playerTuning.open(player.activePath());
playerTuning.onWarmChange = (tuning) => player.applyWarmTuning(tuning);
playerTuning.getWarmStatus = () => player.getWarmBufferStatus();

settings.onOpenDevice = () => deviceInfo.open();

search.onPlay = playLive;
search.onPlayCatchup = playCatchup;
backupDialog.onToast = toast;
backupDialog.onRestore = (text) => {
  try {
    restoreBackup(text);
    toast(t('toast.restoreDone'), 4000);
    setTimeout(() => { try { location.reload(); } catch (e) {} }, 1200);
    return true;
  } catch (e) {
    return false;
  }
};



playerTuning.onApply = () => {
  player.markTuningDirty();
  if (!app.current || player.isCatchup()) return;
  toast(t('toast.tuningApplied'));
  player.stop(); 
  playLive(app.current, 0, app.zapMode);
};

player.onError = (msg) => {
  
  if (tryFailover()) return;
  endLoading();
  toast(msg, 4000);
};


player.onNotice = (msg) => toast(msg, 4000);


player.onRateFail = (reason) => {
  toast(t('cb.speedFail', { reason: t('rate.' + reason) }), 4000);
  catchupBar.syncRate();
};


player.onMediaInfo = (info) => osd.setMediaInfo(info);

osd.getLatency = () => player.getLiveLatency();



player.onStateChange = (ev) => {
  if (ev === 'nativefallback' || ev === 'hlsfallback') {
    beginLoading(true);
  } else if (ev === 'nativereconnect') {
    
    
    loading(true);
  } else if (ev === 'startupmoving' ||
      (ev === 'playing' && (player.activePath() !== 'native' || !zapStarting))) {
    rememberPlayingSource();
    if (typeof runtimeStall !== 'undefined') runtimeStall.progress();
    if (zapStarting && zapStartAt) {
      const warm = player.warmStatus();
      netSpeed.setStartupMs(Date.now() - zapStartAt, warm, player.startupPhases());
    }
    endLoading();
  } else if (ev === 'waiting') {
    if (zapStarting) {
      loading(true);
    } else if (!stallTimer) {
      stallTimer = setTimeout(() => {
        stallTimer = null;
        loading(true);
      }, 1500);
      if (typeof runtimeStall !== 'undefined') runtimeStall.waiting();
    }
  }
};

$('catchup-bar').addEventListener('click', (e) => catchupBar.onClick(e));


function onKey(code, event) {
  
  if (exitDialogOpen) return handleExitKey(code);

  
  if (pinEntry.isOpen()) return pinEntry.handleKey(code);
  if (backupDialog.isOpen()) return backupDialog.handleKey(code);

  
  if (search.isOpen()) return search.handleKey(code);
  if (groupManager.isOpen()) return groupManager.handleKey(code);
  if (playerTuning.isOpen()) return playerTuning.handleKey(code);
  if (deviceInfo.isOpen()) return deviceInfo.handleKey(code);
  if (sourceManager.isOpen()) return sourceManager.handleKey(code, event);
  if (settings.isOpen()) return settings.handleKey(code);
  if (epgGuide.isOpen()) return epgGuide.handleKey(code);
  if (channelEditor.isOpen()) return channelEditor.handleKey(code);
  if (channelMenu.isOpen()) return channelMenu.handleKey(code);
  if (resumePrompt.isOpen()) return resumePrompt.handleKey(code);

  
  if (player.isCatchup() && catchupBar.handleKey(code)) return true;

  
  const d = digitOf(code);
  if (d !== null) {
    pushDigit(d);
    return true;
  }

  
  switch (code) {
    case KEY.OK:
      openChannelMenu();
      break;
    case KEY.LEFT:
      
      if (!switchSource(-1)) openChannelMenu();
      break;
    case KEY.RIGHT:
      if (!switchSource(1)) openChannelMenu();
      break;
    case KEY.UP:
      switchByOffset(1);
      break;
    case KEY.DOWN:
      switchByOffset(-1);
      break;
    case KEY.CH_UP:
      switchByOffset(1);
      break;
    case KEY.CH_DOWN:
      switchByOffset(-1);
      break;
    case KEY.RED:
      openEpgGuide();
      break;
    case KEY.GREEN:
      settings.open();
      break;
    case KEY.YELLOW:
    case KEY.MENU:
      toggleFav();
      break;
    case KEY.BLUE:
      sourceManager.open();
      break;
    case KEY.INFO:
      if (app.current) osd.show(app.current, { catchup: player.isCatchup(), programme: player.current && player.current.programme });
      statusBar.show(5000);
      break;
    case KEY.FF:
      if (player.isCatchup()) player.seek(30);
      break;
    case KEY.RW:
      if (player.isCatchup()) player.seek(-30);
      break;
    case KEY.STOP:
      returnToLive();
      break;
    case KEY.BACK:
      if (player.isCatchup()) returnToLive();
      else openExitDialog();
      break;
    default:
      return false;
  }
  return true;
}

function openChannelMenu() {
  if (!app.channels.length) {
    sourceManager.open();
    return;
  }
  channelMenu.open(visibleChannelsForMenu(), app.current && app.current.key);
}

function openEpgGuide() {
  if (!app.channels.length) return;
  if (!epgStore.loaded) toast(t('toast.noEpgData'));
  epgGuide.open(app.channels, app.current && app.current.key);
}

function toggleFav() {
  if (!app.current) return;
  const added = toggleFavorite(app.current.key);
  
  if (!added && app.zapMode === 'fav' && !isFavorite(app.current.key)) app.zapMode = 'all';
  toast(added ? t('toast.faved', { name: app.current.name }) : t('toast.unfaved'));
}


$('exit-dialog').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'exit') exitApp();
  else closeExitDialog();
});


document.addEventListener('keydown', (e) => {
  player.userUnmute(); 
  const handled = onKey(e.keyCode, e);
  if (handled) {
    e.preventDefault();
    e.stopPropagation();
  }
});

document.addEventListener('click', () => player.userUnmute());


const playerLayer = $('player-layer');
if (playerLayer) {
  
  playerLayer.addEventListener('click', () => {
    if (!anyOverlayOpen()) openChannelMenu();
  });
  
  playerLayer.addEventListener('dblclick', () => {
    if (document.fullscreenElement) document.exitFullscreen && document.exitFullscreen();
    else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
  });
  
  playerLayer.addEventListener('wheel', (e) => {
    if (anyOverlayOpen()) return;
    e.preventDefault();
    switchByOffset(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });
  
  playerLayer.addEventListener('contextmenu', (e) => {
    if (player.isCatchup()) { e.preventDefault(); returnToLive(); }
  });
}


//



//


const DEFAULT_SOURCES = [];


function applySourceCatchup(src, channels) {
  if (!src || !src.catchup) return;
  for (const ch of channels) {
    for (const s of ch.sources || []) {
      if (!s.catchup) {
        s.catchup = src.catchup;
        s.catchupSource = src.catchupSource || '';
        s.catchupDays = src.catchupDays || 7;
      }
    }
    if (!ch.catchup) {
      ch.catchup = src.catchup;
      ch.catchupSource = src.catchupSource || '';
      ch.catchupDays = src.catchupDays || 7;
    }
  }
}







const probingCatchup = new Set();


const catchupNotified = new Set();

function hostOf(url) {
  try {
    return new URL(url, location.href).host;
  } catch (e) {
    return '';
  }
}


function applyProbedCatchup(host, preset) {
  const days = preset.catchupDays || 7;
  let n = 0;
  for (const ch of app.allChannels || []) {
    let hit = false;
    for (const s of ch.sources || []) {
      if (hostOf(s.url) !== host) continue;
      hit = true;
      if (s.catchup) continue;
      s.catchup = preset.catchup;
      s.catchupSource = preset.catchupSource;
      s.catchupDays = days;
    }
    if (!ch.catchup && (hit || hostOf(ch.url) === host)) {
      ch.catchup = preset.catchup;
      ch.catchupSource = preset.catchupSource;
      ch.catchupDays = days;
      n++;
    }
  }
  return n;
}




const RECHECK_GAP = 10 * 60 * 1000;
const lastRecheck = new Map();

async function probeChannelCatchup(ch, opts) {
  const url = ch && ch.url;
  const host = hostOf(url);
  if (!host) return;
  const srcId = (app.source && app.source.id) || '?';
  const key = probeKey(host);
  if (probingCatchup.has(key)) return;

  
  
  const cached = getCatchupProbe(key);
  if (cached) {
    if (cached.result) {
      if (applyProbedCatchup(host, cached.result)) channelMenu.refreshEpg();
      return;
    }
    if (!(opts && opts.recheck)) return;
    if (Date.now() - (lastRecheck.get(key) || 0) < RECHECK_GAP) return;
  }

  probingCatchup.add(key);
  lastRecheck.set(key, Date.now());
  const trace = {
    
    
    busy: !!(player.hls && player.current && hostOf(player.current.url) === host)
  };
  let found = null;
  try {
    found = await probeCatchup(url, { trace });
  } catch (e) {
    
    trace.reason = 'live';
    trace.live = 'net';
    trace.transient = true;
  }
  probingCatchup.delete(key);
  setCatchupProbe(key, found, trace);
  if (found && applyProbedCatchup(host, found)) {
    if (!catchupNotified.has(srcId)) {
      catchupNotified.add(srcId);
      toast(t('toast.catchupDetected', { span: catchupSpan(found.catchupDays) }), 3000);
    }
    channelMenu.refreshEpg();
    if (epgGuide.isOpen()) epgGuide.render();
  } else if (getCatchupProbe(key)) {
    
    channelMenu.refreshEpg();
  }
}

function probeKey(host) {
  return ((app.source && app.source.id) || '?') + '::' + host;
}

function catchupSpan(days) {
  const d = days || 7;
  return d >= 1
    ? t('unit.days', { n: Math.round(d) })
    : t('unit.hours', { n: Math.max(1, Math.round(d * 24)) });
}

function probeErrText(e) {
  if (!e) return '';
  if (/^http /.test(e)) return e.toUpperCase();
  return t('cu.err.' + e);
}


function catchupNote(ch) {
  const host = hostOf(ch && ch.url);
  if (!host) return '';
  const key = probeKey(host);
  if (probingCatchup.has(key)) return t('cu.probing');
  const c = getCatchupProbe(key);
  if (!c) return '';
  const d = c.diag;
  if (c.result) return t('cu.ok', { span: catchupSpan(c.result.catchupDays) }) + probeTail(d);
  let why = t('cu.why.old');
  if (d && d.reason === 'live') why = t('cu.why.live', { err: probeErrText(d.live) });
  else if (d && d.reason === 'nomatch') why = t('cu.why.nomatch');
  else if (d && d.reason === 'mcast') why = t('cu.why.mcast');
  return t('cu.fail', { why }) + probeTail(d);
}


function probeTail(d) {
  if (!d) return '';
  const parts = (d.steps || []).slice();
  if (d.busy) parts.push('★');
  if (typeof d.tz === 'number') parts.push('tz' + (d.tz >= 0 ? '+' : '') + d.tz);
  if (d.ms) parts.push((d.ms / 1000).toFixed(1) + 's');
  return parts.length ? ' [' + parts.join(' ') + ']' : '';
}


function boot() {
  app.settings = getSettings();
  
  if (app.settings.sleepMinutes) {
    app.settings.sleepMinutes = 0;
    saveSettings({ sleepMinutes: 0 });
  }
  fitScreen();
  applySettings(app.settings);
  let sources = getSources();
  let changed = false;

  
  
  
  
  const REMOVED_IDS = [
    'default-liantong',
    'cctv-auto',
    'cctv-public',
    'cctv-online',
    'cctv-fmm-ipv6',
    'gd-dx-hls',
    'gd-dx-local',
    'default-gd'
  ];
  const kept = sources.filter((s) => !REMOVED_IDS.includes(s.id));
  if (kept.length !== sources.length) {
    sources = kept;
    changed = true;
  }

  
  for (const b of DEFAULT_SOURCES) {
    const s = sources.find((x) => x.id === b.id);
    if (s && s.name !== b.name) {
      s.name = b.name;
      changed = true;
    }
  }

  
  
  DEFAULT_SOURCES.forEach((b, i) => {
    if (sources.some((s) => s.id === b.id)) return;
    if (i === 0) {
      sources.unshift({ ...b });
      setActiveSourceId(b.id);
    } else {
      sources.push({ ...b });
    }
    changed = true;
  });
  if (changed) saveSources(sources);

  const activeId = getActiveSourceId();
  const src = sources.find((s) => s.id === activeId) || sources[0];
  
  if (src && src.id !== activeId) setActiveSourceId(src.id);
  const tip = $('empty-tip');
  if (tip) tip.remove();

  
  
  if (!src) {
    sourceManager.open();
    toast(t('toast.addSourceFirst'), 5000);
    return;
  }
  loadSource(src);
}


const origUse = sourceManager.onUseSource;
sourceManager.onUseSource = (src) => {
  const tip = $('empty-tip');
  if (tip) tip.remove();
  origUse(src);
};


document.addEventListener('webOSLocaleChange', applyLanguage);
window.addEventListener('languagechange', applyLanguage);


let wasOffline = false;
window.addEventListener('offline', () => {
  wasOffline = true;
  toast(t('toast.offline'), 3000);
  if (statusBar.isVisible()) statusBar.show(3000);
});
window.addEventListener('online', () => {
  if (statusBar.isVisible()) statusBar.show(3000);
  if (!wasOffline) return;
  wasOffline = false;
  toast(t('toast.online'), 2000);
  
  
  if (app.channels.length && app.current) {
    liveStartAt = Date.now();
    beginLoading();
    player.playLive(app.current, app.settings.decoder);
    schedulePrefetch();
  } else if (app.source) {
    loadSource(app.source);
  }
});
function startApp() {
  const s = app.settings;
  
  
  const storedPin = s ? s.parentalPin : '';
  const migratedPin = migratePin(storedPin);
  if (migratedPin !== storedPin) {
    app.settings.parentalPin = migratedPin;
    saveSettings({ parentalPin: migratedPin });
  }
  if (s && s.appLock && s.parentalPin) {
    askPin({
      title: t('pin.lockTitle'),
      prompt: t('pin.lockPrompt'),
      onSubmit: (pin) => {
        if (!verifyPin(pin)) return false;
        setTimeout(boot, 0);
        return true;
      },
      onCancel: () => exitApp()
    });
    return;
  }
  boot();
}
startApp();
if (window.__bootDone) window.__bootDone();
