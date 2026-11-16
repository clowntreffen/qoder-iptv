

import { proxied } from './net.js';
import { t } from './i18n.js';

const DAY_MS = 24 * 3600 * 1000;


export function diypDateStr(dayOffset = 0) {
  const d = new Date(Date.now() + dayOffset * DAY_MS);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}


function toTs(dateStr, hhmm) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const [H, Mi] = String(hhmm).split(':').map(Number);
  if (!y || isNaN(H)) return NaN;
  return new Date(y, (m || 1) - 1, d || 1, H || 0, Mi || 0, 0, 0).getTime();
}


export async function fetchDiypDay(base, name, dateStr, timeoutMs = 15000) {
  if (!base || !name) return [];
  const sep = base.indexOf('?') >= 0 ? '&' : '?';
  const url = base + sep + 'ch=' + encodeURIComponent(name) + '&date=' + encodeURIComponent(dateStr);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(proxied(url), { signal: controller.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    const day = json.date || dateStr;
    const rows = Array.isArray(json.epg_data) ? json.epg_data : [];
    const list = [];
    for (const p of rows) {
      const start = toTs(day, p.start);
      let stop = toTs(day, p.end);
      if (isNaN(start)) continue;
      
      if (!isNaN(stop) && stop < start) stop += DAY_MS;
      list.push({
        start,
        stop: isNaN(stop) ? start + 3600000 : stop,
        title: (p.title || '').trim() || t('epg.unknownProgramme'),
        desc: (p.desc || '').trim()
      });
    }
    list.sort((a, b) => a.start - b.start);
    return list;
  } finally {
    clearTimeout(timer);
  }
}
