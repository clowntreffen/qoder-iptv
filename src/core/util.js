
import { t } from './i18n.js';

export function pad2(n) {
  return String(n).padStart(2, '0');
}

// HH:MM
export function fmtTime(ms) {
  if (isNaN(ms)) return '';
  const d = new Date(ms);
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

// HH:MM:SS
export function fmtClock(d = new Date()) {
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}


function weekLabel(d) {
  return t('date.weekFmt', { d: t('date.week.' + d.getDay()) });
}
export function fmtDate(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${weekLabel(d)}`;
}


export function fmtDayLabel(dayOffset) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  if (dayOffset === 0) return t('date.today');
  if (dayOffset === 1) return t('date.tomorrow');
  if (dayOffset === -1) return t('date.yesterday');
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${weekLabel(d)}`;
}


export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const LOGO_TINTS = 6;

const failedLogos = new Set();
const FAILED_LOGO_MAX = 500;

export function isLogoFailed(url) {
  return failedLogos.has(url);
}

export function markLogoFailed(url) {
  if (url && failedLogos.size < FAILED_LOGO_MAX) failedLogos.add(url);
}


export function logoText(name) {
  const s = String(name || '').replace(/^[^\p{L}\p{N}]+/u, '');
  const latin = s.match(/^[A-Za-z0-9+\-]+/);
  if (latin) {
    const code = latin[0].replace(/-/g, '').slice(0, 6);
    if (code) return code;
  }
  const chars = Array.from(s).filter((c) => /[\p{L}\p{N}]/u.test(c));
  return chars.slice(0, 2).join('') || '?';
}


function logoWidthClass(text) {
  let w = 0;
  for (const c of text) w += c.charCodeAt(0) > 0x2e7f ? 1 : 0.62;
  return w <= 2 ? 'w-s' : w <= 3.2 ? 'w-m' : 'w-l';
}

function logoTint(name) {
  let h = 0;
  const s = String(name || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % LOGO_TINTS;
}






export function logoHtml(ch) {
  const text = logoText(ch.name);
  const tile = `<span class="logo-txt logo-c${logoTint(ch.name)} ${logoWidthClass(text)}">${esc(text)}</span>`;
  if (!ch.logo || isLogoFailed(ch.logo)) return tile;
  return `<img src="${esc(ch.logo)}" loading="lazy" decoding="async" onerror="this.remove()" />` + tile;
}



export function redactUrl(url) {
  const s = String(url == null ? '' : url);
  if (!s) return s;
  try {
    const u = new URL(s);
    u.search = '';
    u.hash = '';
    return u.href;
  } catch (e) {
    return s.replace(/[?#].*$/, '');
  }
}




export function sanitizeDebug(msg) {
  return String(msg == null ? '' : msg)
    .replace(/https?:\/\/[^\s)\]]+/gi, '<url>')
    .replace(/[\]\[]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
