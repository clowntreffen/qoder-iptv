
//





//






//





//


//



//




import { withHeaders } from '../core/reqHeaders.js';


const MIN_TOTAL = 512 * 1024;

const MIN_SEG = 256 * 1024;



const noRange = new Set();

let lanes = 0; 


let loggedTags = {};

export function setRangeLanes(n) {
  lanes = n >= 2 ? n : 0;
}

export function rangeLanes() {
  return lanes;
}




export function warmLanes() {
  return lanes >= 2 ? Math.max(2, Math.ceil(lanes / 2)) : 0;
}


export function resetRangeLog() {
  loggedTags = {};
}

function perf() {
  try {
    return self.performance.now();
  } catch (e) {
    return Date.now();
  }
}

function originOf(url) {
  try {
    return new URL(url, self.location && self.location.href).origin;
  } catch (e) {
    return url;
  }
}


function parseRange(cr) {
  const m = /^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec((cr || '').trim());
  if (!m) return null;
  const [start, end, total] = m.slice(1).map(Number);
  if (![start, end, total].every(Number.isSafeInteger) || start > end || end >= total) return null;
  return { start, end, total };
}

function cancelBody(body) {
  try {
    const p = body && body.cancel();
    if (p) p.catch(() => {});
  } catch (e) {}
}

function checkAbort(signal) {
  if (signal.aborted) throw new Error('range aborted');
}

async function fetchRange(url, ctl, start, end) {
  checkAbort(ctl.signal);
  const response = await fetch(url, {
    headers: withHeaders(url, { Range: 'bytes=' + start + '-' + end }),
    signal: ctl.signal,
    cache: 'no-store'
  });
  if (ctl.signal.aborted) {
    cancelBody(response.body);
    checkAbort(ctl.signal);
  }
  return response;
}



async function readBody(response, signal, maxBytes, expected) {
  if (signal.aborted) {
    cancelBody(response.body);
    checkAbort(signal);
  }
  const header = response.headers.get('Content-Length');
  const length = /^\d+$/.test(header || '') ? Number(header) : null;
  if (maxBytes > 0 && length > maxBytes) {
    cancelBody(response.body);
    throw { overCap: true, total: length };
  }
  if (expected !== undefined && length !== null && length !== expected) {
    cancelBody(response.body);
    throw new Error('range content length');
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    
    if (maxBytes > 0 || expected !== undefined) {
      cancelBody(response.body);
      throw new Error('bounded response requires a reader');
    }
    const buf = await response.arrayBuffer();
    checkAbort(signal);
    return buf;
  }
  const reader = response.body.getReader();
  const cancel = () => cancelBody(reader);
  const limit = expected === undefined ? maxBytes : expected;
  const chunks = [];
  let loaded = 0;
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      checkAbort(signal);
      const { done, value } = await reader.read();
      checkAbort(signal);
      if (done) break;
      loaded += value.byteLength;
      if (limit > 0 && loaded > limit) {
        if (expected !== undefined) throw new Error('range body too large');
        
        throw { overCap: true, total: loaded };
      }
      chunks.push(value);
    }
    if (expected !== undefined && loaded !== expected) throw new Error('range body too short');
    const out = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out.buffer;
  } catch (e) {
    cancel();
    throw e;
  } finally {
    signal.removeEventListener('abort', cancel);
    try { reader.releaseLock(); } catch (e) {}
  }
}







//
// opts:




export function rangeLoad(url, timeoutMs, opts) {
  if (lanes < 2 || !url) return null;
  if (typeof fetch !== 'function' || typeof AbortController !== 'function') return null;
  if (noRange.has(originOf(url))) return null;

  const o = opts || {};
  const want = o.lanes >= 2 ? o.lanes : lanes;
  const outer = o.signal;
  if (outer && outer.aborted) return null;

  const ctl = new AbortController();
  const t0 = perf();
  let settled = false;
  let timer = null;
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  const fin = (r) => {
    if (settled) return;
    settled = true;
    if (timer !== null) clearTimeout(timer);
    if (outer) {
      try { outer.removeEventListener('abort', stop); } catch (e) {}
    }
    
    if (!r || r.overCap) {
      try { ctl.abort(); } catch (e) {}
    }
    if (!r) {
      try {
        console.log('[' + (o.tag || 'range') + '] fallback after ' + Math.round(perf() - t0) + 'ms');
      } catch (e) {}
    }
    resolve(r);
  };
  const stop = () => fin(null);
  
  if (outer) {
    try { outer.addEventListener('abort', stop, { once: true }); } catch (e) {}
  }
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) timer = setTimeout(stop, timeoutMs);
  
  run(url, ctl, want, o.maxBytes || 0, o.tag || 'range').then(
    fin,
    (err) => fin(err && err.overCap ? err : null)
  );
  return { promise, abort: stop };
}

async function run(url, ctl, want, maxBytes, tag) {
  const t0 = perf();

  
  const probe = await fetchRange(url, ctl, 0, 0);
  const ttfb = perf() - t0;
  if (probe.status === 200) {
    noRange.add(originOf(url));
    const buf = await readBody(probe, ctl.signal, maxBytes);
    return { buf, ms: Math.max(1, perf() - t0), ttfb, lanes: 1 };
  }
  
  const range = probe.status === 206 ? parseRange(probe.headers.get('Content-Range')) : null;
  if (!range || range.start !== 0 || range.end !== 0) {
    cancelBody(probe.body);
    return null;
  }
  const total = range.total;
  
  if (maxBytes > 0 && total > maxBytes) {
    cancelBody(probe.body);
    return { overCap: true, total };
  }
  if (total < MIN_TOTAL) {
    cancelBody(probe.body);
    return null;
  }
  await readBody(probe, ctl.signal, 0, 1);
  checkAbort(ctl.signal);

  const n = Math.max(2, Math.min(want, Math.floor(total / MIN_SEG)));
  const size = Math.ceil(total / n);
  const jobs = [];
  for (let i = 0; i < n; i++) {
    const start = i * size;
    const end = Math.min(total - 1, start + size - 1);
    if (start > end) break;
    jobs.push({ start, end });
  }

  const parts = await Promise.all(
    jobs.map(async (j) => {
      const r = await fetchRange(url, ctl, j.start, j.end);
      const cr = r.status === 206 ? parseRange(r.headers.get('Content-Range')) : null;
      if (!cr || cr.start !== j.start || cr.end !== j.end || cr.total !== total) {
        cancelBody(r.body);
        throw new Error('range response mismatch');
      }
      const b = await readBody(r, ctl.signal, 0, j.end - j.start + 1);
      return { j, b };
    })
  );
  checkAbort(ctl.signal);

  const out = new Uint8Array(total);
  for (const p of parts) {
    const need = p.j.end - p.j.start + 1;
    
    
    if (p.b.byteLength !== need) return null;
    out.set(new Uint8Array(p.b), p.j.start);
  }

  const ms = Math.max(1, perf() - t0);
  if (!loggedTags[tag]) {
    loggedTags[tag] = true;
    try {
      console.log(
        '[' +
          tag +
          '] ' +
          jobs.length +
          'jobs ' +
          (total / 1048576).toFixed(2) +
          'MB / ' +
          (ms / 1000).toFixed(2) +
          's = ' +
          (total / 1048576 / (ms / 1000)).toFixed(2) +
          'MB/s  ttfb=' +
          Math.round(ttfb) +
          'ms'
      );
    } catch (e) {}
  }
  return { buf: out.buffer, ms, ttfb, lanes: jobs.length };
}
