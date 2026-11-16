

import { proxied } from './net.js';


export function parseXmltvTime(str) {
  if (!str) return NaN;
  
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-]\d{4}))?/.exec(str.trim());
  if (!m) return NaN;
  const [, Y, Mo, D, H, Mi, S, tz] = m;
  let ts = Date.UTC(+Y, +Mo - 1, +D, +H, +Mi, +S);
  if (tz) {
    const sign = tz[0] === '-' ? -1 : 1;
    const offMin = sign * (parseInt(tz.slice(1, 3), 10) * 60 + parseInt(tz.slice(3, 5), 10));
    ts -= offMin * 60000; 
  }
  return ts;
}

function textOf(el, tag) {
  const node = el.getElementsByTagName(tag)[0];
  return node ? (node.textContent || '').trim() : '';
}







export function parseXMLTV(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  const channels = new Map();
  const programmes = new Map();

  const chNodes = doc.getElementsByTagName('channel');
  for (let i = 0; i < chNodes.length; i++) {
    const el = chNodes[i];
    const id = el.getAttribute('id') || '';
    if (!id) continue;
    const iconEl = el.getElementsByTagName('icon')[0];
    channels.set(id, {
      id,
      name: textOf(el, 'display-name'),
      icon: iconEl ? iconEl.getAttribute('src') || '' : ''
    });
  }

  const progNodes = doc.getElementsByTagName('programme');
  for (let i = 0; i < progNodes.length; i++) {
    const el = progNodes[i];
    const channelId = el.getAttribute('channel') || '';
    if (!channelId) continue;
    const item = {
      start: parseXmltvTime(el.getAttribute('start')),
      stop: parseXmltvTime(el.getAttribute('stop')),
      title: textOf(el, 'title'),
      desc: textOf(el, 'desc')
    };
    if (isNaN(item.start)) continue;
    if (!programmes.has(channelId)) programmes.set(channelId, []);
    programmes.get(channelId).push(item);
  }

  
  for (const list of programmes.values()) {
    list.sort((a, b) => a.start - b.start);
  }

  return { channels, programmes };
}


export async function fetchXMLTV(url, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(proxied(url), { signal: controller.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    return parseXMLTV(text);
  } finally {
    clearTimeout(timer);
  }
}
