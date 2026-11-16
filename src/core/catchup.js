


import { proxied } from './net.js';


function pad(n, len = 2) {
  return String(n).padStart(len, '0');
}


function timeParts(sec) {
  const d = new Date(sec * 1000);
  return {
    Y: d.getUTCFullYear(),
    m: pad(d.getUTCMonth() + 1),
    d: pad(d.getUTCDate()),
    H: pad(d.getUTCHours()),
    M: pad(d.getUTCMinutes()),
    S: pad(d.getUTCSeconds())
  };
}


function fmtByPattern(sec, pattern) {
  const d = new Date(sec * 1000);
  const map = {
    Y: d.getFullYear(),
    m: pad(d.getMonth() + 1),
    d: pad(d.getDate()),
    H: pad(d.getHours()),
    M: pad(d.getMinutes()),
    S: pad(d.getSeconds())
  };
  return pattern.replace(/[YmdHMS]/g, (c) => String(map[c]));
}


function replaceTokens(template, ctx) {
  const secOf = (key) => {
    const k = key.toLowerCase();
    if (k === 'utc' || k === 'start' || k === 'timestamp') return ctx.start;
    if (k === 'utcend' || k === 'end') return ctx.end;
    if (k === 'lutc' || k === 'now') return ctx.now;
    return null;
  };

  let out = template;

  // {token} / ${token} / {token:FORMAT}
  out = out.replace(
    /\$?\{(utc|start|timestamp|utcend|end|lutc|now|offset|duration|catchup-id)(?::([^}]+))?\}/gi,
    (full, key, fmt) => {
      const k = key.toLowerCase();
      if (k === 'offset') return String(ctx.offset);
      if (k === 'duration') return String(ctx.duration);
      if (k === 'catchup-id') return String(ctx.catchupId || '');
      const sec = secOf(k);
      if (sec == null) return full;
      return fmt ? fmtByPattern(sec, fmt) : String(sec);
    }
  );

  
  const tp = timeParts(ctx.start);
  out = out.replace(/\{(Y|m|d|H|M|S)\}/g, (full, key) => (key in tp ? String(tp[key]) : full));

  
  out = out.replace(/\$\{[^}]*\}/g, '');

  return out;
}


function appendToUrl(url, query) {
  if (!query) return url;
  const q = query.replace(/^[?&]/, '');
  return url + (url.includes('?') ? '&' : '?') + q;
}







export function isCatchupAvailable(channel, programme, defaultDays = 7) {
  if (!channel || !channel.catchup) return false;
  if (!programme || isNaN(programme.start)) return false;
  const now = Date.now();
  if (programme.start >= now) return false; 
  const days = channel.catchupDays > 0 ? channel.catchupDays : defaultDays;
  const windowStart = now - days * 24 * 3600 * 1000;
  return programme.start >= windowStart;
}







export function buildCatchupUrl(channel, programme) {
  if (!channel || !programme) return null;
  
  
  const raw = programme._epg || programme;
  const startSec = Math.floor(raw.start / 1000);
  const rawStop = isNaN(raw.stop) ? raw.start + 3600000 : raw.stop;
  const endSec = Math.floor(rawStop / 1000);
  const nowSec = Math.floor(Date.now() / 1000);
  const ctx = {
    start: startSec,
    end: endSec,
    now: nowSec,
    duration: Math.max(0, endSec - startSec),
    offset: Math.max(0, nowSec - startSec),
    catchupId: channel.tvgId || ''
  };

  const type = (channel.catchup || 'default').toLowerCase();
  const source = channel.catchupSource || '';

  
  if (source) {
    
    if (type === 'append') {
      return appendToUrl(channel.url, replaceTokens(source, ctx));
    }
    
    const resolved = replaceTokens(source, ctx);
    if (/^https?:\/\//i.test(resolved)) return resolved;
    
    return channel.url + resolved;
  }

  
  switch (type) {
    case 'append':
    case 'default':
    case 'shift':
    case 'timeshift':
      return appendToUrl(channel.url, `utc=${ctx.start}&lutc=${ctx.now}`);

    case 'flussonic': {
      
      const url = channel.url;
      if (/\.m3u8(\?|$)/i.test(url)) {
        return url.replace(/\/[^/]*\.m3u8/i, `/index-${ctx.start}-${ctx.duration}.m3u8`);
      }
      
      return appendToUrl(url, `archive=${ctx.start}&duration=${ctx.duration}`);
    }

    case 'xc':
    case 'xtream': {
      
      return appendToUrl(channel.url, `utc=${ctx.start}&lutc=${ctx.now}`);
    }

    default:
      return appendToUrl(channel.url, `utc=${ctx.start}&lutc=${ctx.now}`);
  }
}








export const CATCHUP_PRESETS = [
  
  { catchup: 'append', catchupSource: '?playseek={utc:YmdHMS}-{utcend:YmdHMS}' },
  
  { catchup: 'append', catchupSource: '?playseek={utc}-{utcend}' },
  
  { catchup: 'append', catchupSource: '?utc={utc}&lutc={lutc}' },
  { catchup: 'append', catchupSource: '?starttime={utc:YmdHMS}&endtime={utcend:YmdHMS}' },
  { catchup: 'append', catchupSource: '?begin={utc}&end={utcend}' },
  // Flussonic: .../index.m3u8 -> .../index-{start}-{duration}.m3u8
  { catchup: 'flussonic', catchupSource: '' }
];


function fetchText(url, timeout, info) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    if (ctrl) ctrl.abort();
  }, timeout);
  
  return fetch(proxied(url), { signal: ctrl ? ctrl.signal : undefined, cache: 'no-store' })
    .then((r) => {
      
      const type = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
      if (r.ok && /^video\//i.test(type) && !/mpegurl/i.test(type)) {
        info.err = 'm3u';
        if (ctrl) ctrl.abort();
        return null;
      }
      if (r.ok) return r.text();
      info.err = 'http ' + r.status;
      return null;
    })
    .catch(() => {
      info.err = timedOut ? 'timeout' : 'net';
      return null;
    })
    .finally(() => clearTimeout(timer));
}



function entryUrl(line, base) {
  const u = new URL(line, base);
  const orig = u.pathname === '/__proxy__' && u.searchParams.get('u');
  return orig ? new URL(orig) : u;
}





async function segKeys(url, timeout = 6000, info = {}, depth = 0) {
  const txt = await fetchText(url, timeout, info);
  if (txt == null) return null;
  if (!/#EXTM3U/i.test(txt)) {
    info.err = 'm3u';
    return null;
  }
  const lines = txt.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const media = lines.filter((l) => !l.startsWith('#'));
  if (!media.length) {
    info.err = 'empty';
    return null;
  }
  
  if (/#EXT-X-STREAM-INF/i.test(txt) && depth < 1) {
    let sub;
    try {
      sub = entryUrl(media[0], url).href;
    } catch (e) {
      info.err = 'm3u';
      return null;
    }
    return segKeys(sub, timeout, info, depth + 1);
  }
  return media.map((l) => {
    try {
      return entryUrl(l, url).pathname;
    } catch (e) {
      return l.split('?')[0];
    }
  });
}


const WINDOW_DAYS = [7, 3, 1, 6 / 24, 2 / 24, 1 / 24];


const PROBE_MINUTES = 10;
const MIN_SEGS = 3;

function windowOf(liveUrl, preset, days) {
  const startMs = Date.now() - days * 24 * 3600 * 1000;
  return buildCatchupUrl(
    { url: liveUrl, ...preset },
    { start: startMs, stop: startMs + PROBE_MINUTES * 60 * 1000 }
  );
}


export function isTransientProbeErr(r) {
  return r === 'timeout' || r === 'net' || /^http 5/.test(r);
}


async function attempt(url, timeout, baseSet) {
  const info = {};
  const keys = await segKeys(url, timeout, info);
  if (!keys) return info.err || 'net';
  if (keys.some((k) => baseSet.has(k))) return 'live';
  if (keys.length < MIN_SEGS) return 'n' + keys.length;
  return 'ok';
}

function daysTag(d) {
  return d >= 1 ? d + 'd' : Math.round(d * 24) + 'h';
}








export async function probeCatchup(liveUrl, opts = {}) {
  const trace = opts.trace || {};
  trace.steps = [];
  trace.tz = -new Date().getTimezoneOffset() / 60;
  const t0 = Date.now();
  const done = (v) => {
    trace.ms = Date.now() - t0;
    return v;
  };
  if (!liveUrl || !/^https?:\/\//i.test(liveUrl)) {
    trace.reason = 'live';
    trace.live = 'url';
    return done(null);
  }
  
  if (/\/(rtp|udp)\//i.test(liveUrl)) {
    trace.reason = 'mcast';
    return done(null);
  }
  const timeout = opts.timeout || 6000;

  
  
  
  
  
  
  
  const liveInfo = {};
  const base = await segKeys(liveUrl, timeout, liveInfo);
  
  
  if (!base || !base.length) {
    trace.reason = 'live';
    trace.live = liveInfo.err || 'empty';
    trace.transient = isTransientProbeErr(trace.live);
    return done(null);
  }
  const baseSet = new Set(base);

  
  let hit = null;
  for (let i = 0; i < CATCHUP_PRESETS.length; i++) {
    const preset = CATCHUP_PRESETS[i];
    const url = windowOf(liveUrl, preset, 1 / 24);
    if (!url || url === liveUrl) continue;
    const r = await attempt(url, timeout, baseSet);
    trace.steps.push(i + ':' + r);
    if (isTransientProbeErr(r)) trace.transient = true;
    if (r === 'ok') {
      hit = preset;
      break;
    }
  }
  if (!hit) {
    trace.reason = 'nomatch';
    return done(null);
  }

  
  
  
  let days = 1 / 24; 
  for (const d of WINDOW_DAYS) {
    if (d <= days) break;
    const r = await attempt(windowOf(liveUrl, hit, d), timeout, baseSet);
    trace.steps.push(daysTag(d) + ':' + r);
    if (isTransientProbeErr(r)) trace.transient = true;
    if (r === 'ok') {
      days = d;
      break;
    }
  }

  return done({ ...hit, catchupDays: days });
}

export { replaceTokens };
