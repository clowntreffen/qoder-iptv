
//




//




const byOrigin = new Map();
const MAX_ORIGINS = 32;

function originOf(url) {
  try {
    const base = typeof location !== 'undefined' ? location.href : undefined;
    const o = new URL(url, base).origin;
    return o && o !== 'null' ? o : '';
  } catch (e) {
    return '';
  }
}


export function rememberHeaders(url, headers) {
  const origin = originOf(url);
  if (!origin || !headers) return;
  const clean = {};
  let n = 0;
  for (const k in headers) {
    const v = headers[k];
    if (!v) continue;
    clean[k] = String(v);
    n++;
  }
  if (!n) return;
  const prev = byOrigin.get(origin);
  byOrigin.delete(origin); 
  byOrigin.set(origin, clean);
  while (byOrigin.size > MAX_ORIGINS) {
    byOrigin.delete(byOrigin.keys().next().value);
  }
  if (prev && JSON.stringify(prev) === JSON.stringify(clean)) return; 
  try { console.log('[hdr] ' + origin + ' [' + Object.keys(clean).join(',') + ']'); } catch (e) {}
}

export function headersFor(url) {
  const origin = originOf(url);
  return origin ? byOrigin.get(origin) || null : null;
}


export function applyHeaders(xhr, url) {
  const headers = headersFor(url);
  if (!headers || !xhr) return;
  for (const k in headers) {
    try { xhr.setRequestHeader(k, headers[k]); } catch (e) {}
  }
}


export function withHeaders(url, extra) {
  const headers = headersFor(url);
  if (!headers) return extra || undefined;
  return extra ? { ...headers, ...extra } : headers;
}

export function clearHeaders() {
  byOrigin.clear();
}
