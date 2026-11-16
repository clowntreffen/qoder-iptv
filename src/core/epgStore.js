


import { fetchXMLTV } from './xmltvParser.js';
import { fetchDiypDay, diypDateStr } from './diyp.js';
import { getEpgCache, setEpgCache } from './storage.js';
import { redactUrl } from './util.js';
import { programmeEntries } from './epgSearch.js';

const DAY_MS = 24 * 3600 * 1000;
const CACHE_TTL = 6 * 3600 * 1000; 
const RETRY_DELAY = 60 * 1000; 

const SHIFTED_MAX = 500;



const CCTV_BY_NAME = {
  \u7efc\u5408: 1, \u8d22\u7ecf: 2, \u7efc\u827a: 3, \u4e2d\u6587\u56fd\u9645: 4, \u4f53\u80b2: 5, \u7535\u5f71: 6, \u56fd\u9632\u519b\u4e8b: 7, \u519b\u4e8b: 7,
  \u7535\u89c6\u5267: 8, \u7eaa\u5f55: 9, \u79d1\u6559: 10, \u620f\u66f2: 11, \u793e\u4f1a\u4e0e\u6cd5: 12, \u65b0\u95fb: 13, \u5c11\u513f: 14,
  \u97f3\u4e50: 15, \u5965\u6797\u5339\u514b: 16, \u519c\u4e1a\u519c\u6751: 17, \u519c\u4e1a: 17
};




export function normalizeEpgName(name) {
  if (!name) return '';
  let s = String(name);
  try { s = s.normalize('NFKC'); } catch (e) {}
  s = s.toLowerCase().replace(/[\s\-_\u00b7\u30fb()\uff08\uff09\[\]\u3010\u3011]/g, '');
  
  s = s.replace(/(\u8d85\u9ad8\u6e05|\u9ad8\u6e05|\u6807\u6e05|\u84dd\u5149|uhd|fhd|hd|sd|4k|8k|h265|hevc|hdr)/g, '');
  const cen = /^\u4e2d\u592e(?:\u7535\u89c6\u53f0)?(?:cctv)?(\d{1,2})(?:\+)?(?:\u9891\u9053)?$/.exec(s);
  if (cen) return 'cctv' + Number(cen[1]);
  const cenStation = /^\u4e2d\u592e(?:\u7535\u89c6\u53f0)?(\d{1,2})\u53f0$/.exec(s);
  if (cenStation) return 'cctv' + Number(cenStation[1]);
  const named = /^\u4e2d\u592e(?:\u7535\u89c6\u53f0)?(.+?)(?:\u9891\u9053)?$/.exec(s);
  if (named && CCTV_BY_NAME[named[1]]) return 'cctv' + CCTV_BY_NAME[named[1]];
  const m = /^cctv(\d{1,2})(\+)?(.*)$/.exec(s);
  if (m) {
    
    
    const rest = m[3] || '';
    const channelName = /^(\u7efc\u5408|\u8d22\u7ecf|\u7efc\u827a|\u4e2d\u6587\u56fd\u9645|\u56fd\u9645|\u4f53\u80b2\u8d5b\u4e8b|\u4f53\u80b2|\u7535\u5f71|\u56fd\u9632\u519b\u4e8b|\u519b\u4e8b|\u7535\u89c6\u5267|\u7eaa\u5f55|\u79d1\u6559|\u620f\u66f2|\u793e\u4f1a\u4e0e\u6cd5|\u65b0\u95fb|\u5c11\u513f|\u97f3\u4e50|\u5965\u6797\u5339\u514b|\u519c\u4e1a\u519c\u6751|\u519c\u4e1a|\u9891\u9053)$/;
    return 'cctv' + Number(m[1]) + (m[2] || '') + (rest && !channelName.test(rest) ? rest : '');
  }
  return s;
}





function detectMode(url, type) {
  if (type) return type;
  if (/(?:\?|&)ch=/.test(url)) return 'diyp';
  return 'xmltv';
}

class EpgStore {
  constructor() {
    this.mode = '';
    this.url = '';
    this.channels = new Map();
    this.programmes = new Map(); // key -> sorted [{start,stop,title,desc}]
    this.loaded = false;
    
    
    
    this.version = 0;
    
    this._loadId = 0;

    
    this.loadedDays = new Map(); // 'name|YYYY-MM-DD' -> expire
    this.retryAfter = new Map(); 
    this.pending = new Map(); 
    
    
    this._shifted = new Map();
    this._nameIndex = null; 
    this._forceRefresh = false;
    this._entries = null;
    this._entriesVersion = -1;
    this.onUpdate = null; 
    this._updTimer = null;
  }

  clear() {
    this._loadId++;
    this.url = '';
    this.mode = '';
    this._forceRefresh = false;
    this.channels.clear();
    this.programmes.clear();
    this.loadedDays.clear();
    this.retryAfter.clear();
    this.pending.clear();
    this._shifted.clear();
    this._nameIndex = null;
    this._entries = null;
    this._entriesVersion = -1;
    this.loaded = false;
    this.version++;
    
    if (this._updTimer) {
      clearTimeout(this._updTimer);
      this._updTimer = null;
    }
  }

  
  async load(url, type, { force = false } = {}) {
    this.clear();
    this.url = url || '';
    if (!url) return false;
    const loadId = this._loadId;
    this._forceRefresh = force;
    this.mode = detectMode(url, type);
    if (this.mode === 'diyp') {
      
      this.loaded = true;
      return true;
    }
    return this._loadXmltv(url, loadId);
  }

  
  async _loadXmltv(url, loadId) {
    const cached = this._forceRefresh ? null : getEpgCache(url);
    if (cached && cached.expire > Date.now() && cached.data) {
      if (loadId !== this._loadId) return null;
      this._ingestRaw(cached.data);
      this._refreshXmltv(url, loadId); 
      return true;
    }
    return this._refreshXmltv(url, loadId);
  }

  async _refreshXmltv(url, loadId) {
    try {
      const { channels, programmes } = await fetchXMLTV(url);
      if (loadId !== this._loadId) return null;
      
      
      
      
      if (!programmes.size) {
        console.warn('[EPG] cannot parse XMLTV programmes, falling back to DIYP API:', redactUrl(url));
        this.mode = 'diyp';
        this.loaded = true;
        this._scheduleUpdate();
        return true;
      }
      this.channels = channels;
      this.programmes = programmes;
      this._buildNameIndex();
      this.loaded = true;
      this.version++;
      const raw = {
        channels: Array.from(channels.values()),
        programmes: Array.from(programmes.entries())
      };
      setEpgCache(url, raw, CACHE_TTL);
      this._scheduleUpdate();
      return true;
    } catch (e) {
      if (loadId !== this._loadId) return null;
      const cached = getEpgCache(url);
      if (!this.loaded && cached && cached.data) {
        this._ingestRaw(cached.data);
        this._scheduleUpdate();
        return true;
      }
      console.warn('[EPG] XMLTV load failed:', e && e.message);
      return this.loaded;
    }
  }

  _ingestRaw(raw) {
    const channels = new Map();
    (raw.channels || []).forEach((c) => channels.set(c.id, c));
    const programmes = new Map();
    (raw.programmes || []).forEach(([id, list]) => programmes.set(id, list));
    this.channels = channels;
    this.programmes = programmes;
    this._buildNameIndex();
    this.loaded = true;
    this.version++;
  }

  
  
  _buildNameIndex() {
    const idx = new Map();
    const add = (name, key) => {
      if (!name) return;
      const n = normalizeEpgName(name);
      if (!n || idx.has(n) || !this.programmes.has(key)) return;
      idx.set(n, key);
    };
    for (const [id, c] of this.channels) {
      add(c && c.name, id);
      add(id, id);
    }
    for (const key of this.programmes.keys()) add(key, key);
    this._nameIndex = idx;
  }

  
  _diypName(channel) {
    if (!channel) return '';
    return (channel.epgName || channel.name || '').trim();
  }

  _key(channel) {
    if (!channel) return '';
    if (this.mode === 'diyp') return this._diypName(channel);
    
    const id = channel.tvgId;
    if (id && this.programmes.has(id)) return id;
    const nm = this._diypName(channel);
    if (nm && this.programmes.has(nm)) return nm;
    const hit = this._nameIndex && this._nameIndex.get(normalizeEpgName(nm));
    if (hit) return hit;
    return id || nm;
  }

  
  ensure(channel, dayOffset = 0) {
    if (!this.loaded || !this.url || this.mode !== 'diyp') return;
    const name = this._diypName(channel);
    if (!name) return;
    const ds = diypDateStr(dayOffset);
    const loadKey = name + '|' + ds;
    const now = Date.now();
    if (this.pending.has(loadKey) || this.loadedDays.get(loadKey) > now || this.retryAfter.get(loadKey) > now) return;
    this.loadedDays.delete(loadKey);
    this.retryAfter.delete(loadKey);

    const loadId = this._loadId;
    const sourceUrl = this.url;
    const cacheKey = 'diyp:' + sourceUrl + ':' + loadKey;
    const cached = this._forceRefresh ? null : getEpgCache(cacheKey);
    if (cached && cached.expire > now && cached.data) {
      this._mergeDay(name, ds, cached.data);
      this.loadedDays.set(loadKey, cached.expire);
      return;
    }

    const p = fetchDiypDay(sourceUrl, name, ds)
      .then((list) => {
        if (loadId !== this._loadId || this.pending.get(loadKey) !== p) return;
        this._mergeDay(name, ds, list);
        this.loadedDays.set(loadKey, Date.now() + CACHE_TTL);
        this.retryAfter.delete(loadKey);
        setEpgCache(cacheKey, list, CACHE_TTL);
        this.pending.delete(loadKey);
        this._scheduleUpdate();
      })
      .catch(() => {
        if (loadId !== this._loadId || this.pending.get(loadKey) !== p) return;
        this.pending.delete(loadKey);
        if (!this.programmes.has(name)) {
          const stale = getEpgCache(cacheKey);
          if (stale && stale.data) this._mergeDay(name, ds, stale.data);
        }
        this.retryAfter.set(loadKey, Date.now() + RETRY_DELAY);
      });
    this.pending.set(loadKey, p);
  }

  _mergeDay(name, ds, list) {
    const [y, m, d] = ds.split('-').map(Number);
    const dayStart = new Date(y, m - 1, d).getTime();
    const dayEnd = new Date(y, m - 1, d + 1).getTime();
    const cur = this.programmes.get(name) || [];
    
    const byStart = new Map();
    for (const p of cur) {
      if (p.start < dayStart || p.start >= dayEnd) byStart.set(p.start, p);
    }
    for (const p of list || []) byStart.set(p.start, p);
    const next = Array.from(byStart.values()).sort((a, b) => a.start - b.start);
    if (this.programmes.has(name) && cur.length === next.length && cur.every((p, i) => {
      const n = next[i];
      return p.start === n.start && Object.is(p.stop, n.stop) && p.title === n.title && p.desc === n.desc;
    })) return; 
    this.programmes.set(name, next);
    this.version++;
  }

  _scheduleUpdate() {
    if (this._updTimer) return;
    this._updTimer = setTimeout(() => {
      this._updTimer = null;
      if (this.onUpdate) this.onUpdate();
    }, 200);
  }

  
  
  
  
  // Public key lookup so search can map a programme back to its channels.
  epgKeyOf(channel) {
    return this._key(channel);
  }

  // Flat programme list for the search index, rebuilt only when the store
  // changed. Cached because a full EPG can hold tens of thousands of items.
  programmeEntries() {
    if (this._entries && this._entriesVersion === this.version) return this._entries;
    this._entries = programmeEntries(this.programmes);
    this._entriesVersion = this.version;
    return this._entries;
  }

  getList(channel) {
    const key = this._key(channel);
    if (!key) return [];
    const list = this.programmes.get(key) || [];
    const shiftMs = ((channel && parseInt(channel.tvgShift, 10)) || 0) * 3600000
      + ((channel && parseInt(channel.epgOffsetMinutes, 10)) || 0) * 60000;
    if (!shiftMs || !list.length) return list;
    const ck = shiftMs + '|' + key;
    const hit = this._shifted.get(ck);
    if (hit && hit.src === list) return hit.out;
    const out = list.map((p) => ({ ...p, start: p.start + shiftMs, stop: p.stop + shiftMs, _epg: p }));
    if (this._shifted.size >= SHIFTED_MAX) this._shifted.clear();
    this._shifted.set(ck, { src: list, out });
    return out;
  }

  
  getNowNext(channel, at = Date.now()) {
    this.ensure(channel, 0);
    const list = this.getList(channel);
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const stop = isNaN(p.stop) ? p.start + 3600000 : p.stop;
      if (at >= p.start && at < stop) {
        return { now: p, next: list[i + 1] || null };
      }
      if (at < p.start) {
        return { now: null, next: p };
      }
    }
    return { now: null, next: null };
  }

  
  getDayProgrammes(channel, dayOffset = 0) {
    this.ensure(channel, dayOffset);
    const list = this.getList(channel);
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    const dayStart = base.getTime() + dayOffset * DAY_MS;
    const dayEnd = dayStart + DAY_MS;
    return list.filter((p) => p.start < dayEnd && (isNaN(p.stop) ? p.start : p.stop) > dayStart);
  }
}

export const epgStore = new EpgStore();
export { DAY_MS };
