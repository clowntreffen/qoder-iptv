
import { normalizeOverrides } from './channelCustomization.js';
import { DEFAULT_THEME, isValidTheme } from './themes.js';

const NS = 'iptv:';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(NS + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}



function pruneEpgCache(expiredOnly = true) {
  let n = 0;
  try {
    const now = Date.now();
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith(NS + 'epg:')) continue;
      if (expiredOnly) {
        let keep = false;
        try {
          const v = JSON.parse(localStorage.getItem(k));
          keep = !!(v && v.expire > now);
        } catch (e) {}
        if (keep) continue;
      }
      localStorage.removeItem(k);
      n++;
    }
  } catch (e) {}
  return n;
}

function write(key, value) {
  const raw = JSON.stringify(value);
  try {
    localStorage.setItem(NS + key, raw);
    return true;
  } catch (e) {
    
    
    for (const expiredOnly of [true, false]) {
      if (!pruneEpgCache(expiredOnly)) continue;
      try {
        localStorage.setItem(NS + key, raw);
        return true;
      } catch (e2) {}
    }
    if (!key.startsWith('epg:')) console.warn('[storage] write failed (quota full):', key);
    return false;
  }
}

function remove(key) {
  try {
    localStorage.removeItem(NS + key);
  } catch (e) {}
}


// source: { id, name, m3uUrl, epgUrl }
export function getSources() {
  return read('sources', []);
}
export function saveSources(list) {
  write('sources', list);
}
export function getActiveSourceId() {
  return read('activeSource', null);
}
export function setActiveSourceId(id) {
  write('activeSource', id);
}


const DEFAULT_SETTINGS = {
  aspect: '16:9', // 16:9 | 4:3 | fill
  
  
  decoder: 'auto', // auto | native | hls
  autoPlayLast: true,
  showNetSpeed: false, 
  fontScale: 1,
  theme: DEFAULT_THEME,
  language: 'en', // UI fixed to English; value kept only for saved-settings compatibility
  languageVersion: 3,
  autoRefresh: true,
  sleepMinutes: 0,
  parentalPin: '',
  appLock: false,
  debugOverlay: false
};
export function getSettings() {
  const raw = read('settings', {});
  const s = { ...DEFAULT_SETTINGS, ...raw };
  
  
  if (raw.languageVersion !== DEFAULT_SETTINGS.languageVersion) {
    s.language = 'en';
    s.languageVersion = DEFAULT_SETTINGS.languageVersion;
  }
  s.language = 'en';
  if (!isValidTheme(s.theme)) s.theme = DEFAULT_THEME;
  const scale = Number(s.fontScale);
  s.fontScale = Number.isFinite(scale) && scale >= 0.8 && scale <= 1.3 ? scale : 1;
  return s;
}
export function saveSettings(s) {
  write('settings', { ...getSettings(), ...s });
}


//





let favArr = null; 
let favSet = null; 
let favVer = 0; 

export function getFavorites() {
  if (!favArr) favArr = read('favorites', []);
  return favArr;
}

export function favVersion() {
  return favVer;
}
export function saveFavorites(list) {
  favArr = list;
  favSet = null;
  favVer++;
  write('favorites', list);
}
export function isFavorite(key) {
  if (!favSet) favSet = new Set(getFavorites());
  return favSet.has(key);
}
export function toggleFavorite(key) {
  const list = getFavorites();
  const idx = list.indexOf(key);
  if (idx >= 0) list.splice(idx, 1);
  else list.push(key);
  saveFavorites(list);
  return idx < 0; 
}


export function getLastChannelKey() {
  return read('lastChannel', null);
}
export function setLastChannelKey(key) {
  write('lastChannel', key);
}




const SRCMEM_MAX = 400;
export function getLastSourceIdx(key) {
  const map = read('lastSource', null);
  const v = map && typeof map === 'object' && !Array.isArray(map) ? map[key] : undefined;
  return Number.isInteger(v) && v >= 0 ? v : 0;
}
export function setLastSourceIdx(key, idx) {
  if (!key || !Number.isInteger(idx) || idx < 0) return;
  const stored = read('lastSource', null);
  const map = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  delete map[key];
  map[key] = idx;
  const keys = Object.keys(map);
  if (keys.length > SRCMEM_MAX) {
    keys.slice(0, keys.length - SRCMEM_MAX).forEach((k) => delete map[k]);
  }
  write('lastSource', map);
}


const RECENT_MAX = 30;
export function getRecents() {
  const list = read('recents', []);
  return Array.isArray(list) ? list.filter((k) => typeof k === 'string' && k) : [];
}
export function recordRecent(key) {
  if (!key || typeof key !== 'string') return getRecents();
  const list = getRecents().filter((k) => k !== key);
  list.unshift(key);
  list.length = Math.min(list.length, RECENT_MAX);
  write('recents', list);
  return list;
}
export function clearRecents() {
  remove('recents');
}




const RESUME_MAX = 200;
function resumeMap(fallback) {
  const v = read('resume', null);
  return v && typeof v === 'object' && !Array.isArray(v) ? v : fallback;
}
export function getResumePosition(key) {
  if (!key) return 0;
  const map = resumeMap(null);
  const v = map ? map[key] : undefined;
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}
export function setResumePosition(key, secs) {
  if (!key) return;
  const s = Number.isFinite(secs) ? Math.max(0, Math.floor(secs)) : 0;
  if (!s) { removeResumePosition(key); return; }
  const map = { ...resumeMap({}) };
  delete map[key];
  map[key] = s;
  const keys = Object.keys(map);
  if (keys.length > RESUME_MAX) {
    keys.slice(0, keys.length - RESUME_MAX).forEach((k) => delete map[k]);
  }
  write('resume', map);
}
export function removeResumePosition(key) {
  if (!key) return;
  const map = resumeMap(null);
  if (!map || !(key in map)) return;
  const next = { ...map };
  delete next[key];
  write('resume', next);
}



export function getLockedGroups() {
  const list = read('lockedGroups', []);
  return Array.isArray(list) ? list.filter((g) => typeof g === 'string' && g) : [];
}
export function setLockedGroups(list) {
  write('lockedGroups', Array.isArray(list) ? list.filter((g) => typeof g === 'string' && g) : []);
}
export function isGroupLocked(name) {
  return !!name && getLockedGroups().includes(name);
}


export function getChannelOverrides() {
  return normalizeOverrides(read('channelOverrides', null));
}
export function setChannelOverrides(map) {
  write('channelOverrides', normalizeOverrides(map));
}


export function getM3uCache(url) {
  const v = read('m3u:' + url, null);
  return v && typeof v.text === 'string' ? v : null;
}
export function setM3uCache(url, text, baseUrl) {
  if (!url || typeof text !== 'string') return false;
  return write('m3u:' + url, { text, baseUrl: baseUrl || '', fetchedAt: Date.now() });
}
export function clearM3uCache() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(NS + 'm3u:'))
      .forEach((k) => localStorage.removeItem(k));
  } catch (e) {}
}


export function getEpgCache(url) {
  return read('epg:' + url, null);
}
export function setEpgCache(url, data, ttlMs) {
  write('epg:' + url, { data, expire: Date.now() + ttlMs });
}
export function clearEpgCache() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(NS + 'epg:'))
      .forEach((k) => localStorage.removeItem(k));
  } catch (e) {}
}





export const CATCHUP_TTL_OK = 3 * 24 * 3600 * 1000;
export const CATCHUP_TTL_FAIL = 6 * 3600 * 1000;

export const CATCHUP_TTL_RETRY = 5 * 60 * 1000;

export function getCatchupProbe(key) {
  const v = read('cp:' + key, null);
  if (!v || !v.expire || v.expire < Date.now()) return null;
  return v; // { result: {catchup,catchupSource,catchupDays}|null, expire, diag? }
}
export function setCatchupProbe(key, result, diag) {
  const ttl = diag && diag.transient ? CATCHUP_TTL_RETRY : result ? CATCHUP_TTL_OK : CATCHUP_TTL_FAIL;
  write('cp:' + key, { result: result || null, expire: Date.now() + ttl, diag: diag || null });
}
export function clearCatchupProbe() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(NS + 'cp:'))
      .forEach((k) => localStorage.removeItem(k));
  } catch (e) {}
}

export { read, write, remove };
