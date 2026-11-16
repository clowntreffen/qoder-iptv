

import { proxied } from './net.js';
import { getM3uCache, setM3uCache } from './storage.js';

const ATTR_RE = /([a-zA-Z0-9_-]+)="([^"]*)"/g;



function attrSeparatorIndex(line) {
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\' && inQuotes && i + 1 < line.length) { i++; continue; }
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ',' && !inQuotes) return i;
  }
  return -1;
}

function parseAttrs(line) {
  const attrs = {};
  ATTR_RE.lastIndex = 0; 
  let m;
  while ((m = ATTR_RE.exec(line)) !== null) {
    attrs[m[1].toLowerCase()] = m[2];
  }
  ATTR_RE.lastIndex = 0;
  return attrs;
}



function resolveReference(value, baseUrl) {
  const raw = String(value || '').trim();
  if (!raw || !baseUrl) return raw;
  try {
    return new URL(raw, baseUrl).href;
  } catch (e) {
    return raw;
  }
}




function parseHeader(headerLine, baseUrl) {
  const attrs = parseAttrs(headerLine);
  const url = attrs['url-tvg'] || attrs['x-tvg-url'] || '';
  
  const epgUrl = resolveReference(url.split(',')[0], baseUrl);
  const days = parseInt(attrs['catchup-days'] || attrs['tvg-rec'] || '0', 10) || 0;
  const shift = parseInt(attrs['tvg-shift'], 10);
  return {
    epgUrl,
    catchup: attrs['catchup'] || attrs['catchup-type'] || '',
    catchupSource: attrs['catchup-source'] || '',
    catchupDays: days,
    seekPreview: attrs['seek_preview'] || attrs['seek-preview'] || '',
    tvgShift: Number.isNaN(shift) ? 0 : shift
  };
}







export function parseM3U(text, baseUrl = '') {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const raws = [];
  let hdr = parseHeader('', baseUrl);
  let pending = null;

  for (let raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('#EXTM3U')) {
      hdr = parseHeader(line, baseUrl);
      continue;
    }

    if (line.startsWith('#EXTINF')) {
      const attrs = parseAttrs(line);
      
      const commaIdx = attrSeparatorIndex(line);
      const title = commaIdx >= 0 ? line.slice(commaIdx + 1).trim() : '';
      const tvgName = attrs['tvg-name'] || '';
      
      
      const catchupType = attrs['catchup'] || attrs['catchup-type'] || '';
      const catchupDays =
        parseInt(attrs['catchup-days'] || attrs['tvg-rec'] || attrs['timeshift'] || '0', 10) ||
        hdr.catchupDays || 0;
      const shift = parseInt(attrs['tvg-shift'], 10);
      pending = {
        tvgId: attrs['tvg-id'] || '',
        title: title || tvgName || 'Unnamed',
        tvgName,
        logo: resolveReference(attrs['tvg-logo'], baseUrl),
        group: attrs['group-title'] || 'Ungrouped',
        catchup: catchupType || (catchupDays > 0 ? 'default' : ''),
        catchupSource: attrs['catchup-source'] || hdr.catchupSource || '',
        catchupDays,
        seekPreview: attrs['seek_preview'] || attrs['seek-preview'] || hdr.seekPreview || '',
        tvgShift: Number.isNaN(shift) ? hdr.tvgShift : shift,
        chnoRaw: parseInt(attrs['tvg-chno'], 10) || 0,
        headers: {}
      };
      continue;
    }

    
    if (line.startsWith('#EXTVLCOPT') && pending) {
      const kv = line.slice(line.indexOf(':') + 1);
      const eq = kv.indexOf('=');
      if (eq > 0) {
        const k = kv.slice(0, eq).trim().toLowerCase();
        const v = kv.slice(eq + 1).trim();
        if (k === 'http-user-agent') pending.headers['User-Agent'] = v;
        if (k === 'http-referrer' || k === 'http-referer') pending.headers['Referer'] = v;
      }
      continue;
    }

    if (line.startsWith('#')) continue; 

    
    if (pending) {
      pending.url = resolveReference(line, baseUrl);
      raws.push(pending);
      pending = null;
    }
  }

  return { epgUrl: hdr.epgUrl, channels: groupByName(raws) };
}


export function applyActiveSource(ch) {
  const s = ch.sources[ch.sourceIdx] || ch.sources[0];
  if (!s) return;
  ch.url = s.url;
  ch.catchup = s.catchup;
  ch.catchupSource = s.catchupSource;
  ch.catchupDays = s.catchupDays;
  ch.seekPreview = s.seekPreview;
  ch.headers = s.headers;
  if (s.logo) ch.logo = s.logo;
}



function groupByName(raws) {
  const map = new Map(); // 'group|title' -> channel
  const channels = [];
  for (const r of raws) {
    const source = {
      label: r.title,
      url: r.url,
      logo: r.logo,
      catchup: r.catchup,
      catchupSource: r.catchupSource,
      catchupDays: r.catchupDays,
      seekPreview: r.seekPreview,
      headers: r.headers
    };
    const gkey = r.group + '|' + r.title;
    if (map.has(gkey)) {
      const ch = map.get(gkey);
      ch.sources.push(source);
      
      if (!ch.tvgShift && r.tvgShift) ch.tvgShift = r.tvgShift;
      if (!ch.chnoRaw && r.chnoRaw) ch.chnoRaw = r.chnoRaw;
      continue;
    }
    const ch = {
      tvgId: r.tvgId,
      chno: '', 
      name: r.title, 
      epgName: r.tvgName || r.title, 
      group: r.group,
      logo: r.logo,
      tvgShift: r.tvgShift || 0, 
      chnoRaw: r.chnoRaw || 0, 
      sources: [source],
      sourceIdx: 0,
      key: 'ch:' + gkey 
    };
    map.set(gkey, ch);
    channels.push(ch);
  }
  channels.forEach((ch) => applyActiveSource(ch));
  renumberChannels(channels);
  return channels;
}













export function renumberChannels(channels) {
  const groups = new Map();
  for (const ch of channels) {
    if (!groups.has(ch.group)) groups.set(ch.group, []);
    groups.get(ch.group).push(ch);
  }
  if (channels.some((ch) => ch.chnoRaw > 0)) {
    const used = new Set();
    for (const ch of channels) {
      if (ch.chnoRaw > 0 && !used.has(ch.chnoRaw)) {
        used.add(ch.chnoRaw);
        ch.chno = String(ch.chnoRaw);
      } else {
        ch.chno = ''; 
      }
    }
    let n = 0;
    for (const ch of channels) {
      if (ch.chno) continue;
      do { n++; } while (used.has(n));
      used.add(n);
      ch.chno = String(n);
    }
  } else {
    let n = 0;
    for (const arr of groups.values()) {
      for (const ch of arr) {
        ch.chno = String(++n);
      }
    }
  }
  
  let idx = 0;
  for (const arr of groups.values()) {
    for (const ch of arr) ch.index = ++idx;
  }
  return channels;
}






export function groupChannels(channels) {
  const map = new Map();
  for (const ch of channels) {
    if (!map.has(ch.group)) map.set(ch.group, []);
    map.get(ch.group).push(ch);
  }
  return Array.from(map.entries()).map(([name, list]) => ({ name, channels: list }));
}



function responseBaseUrl(res, requestedUrl) {
  const finalUrl = (res && res.url) || '';
  if (!finalUrl) return requestedUrl;
  try {
    const parsed = new URL(finalUrl);
    if (parsed.pathname.endsWith('/__proxy__')) {
      return parsed.searchParams.get('u') || requestedUrl;
    }
    return finalUrl;
  } catch (e) {
    return requestedUrl;
  }
}




export async function fetchM3U(url, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    
    const res = await fetch(proxied(url), { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    const baseUrl = responseBaseUrl(res, url);
    setM3uCache(url, text, baseUrl);
    return parseM3U(text, baseUrl);
  } catch (e) {
    const cached = getM3uCache(url);
    if (cached && cached.text) {
      return parseM3U(cached.text, cached.baseUrl || url);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
