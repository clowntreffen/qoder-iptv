
//


//



//



//





import { rangeLoad, resetRangeLog } from './rangeLoad.js';
import { redactUrl } from '../core/util.js';




const TTL_MS = 30000;

const store = new Map(); // url -> { buf: ArrayBuffer, ms: number, at: number }


//




const pending = new Map();


//







//

const WARM_MS_GUESS = 2500;
const OWN_MS_GUESS = 1200;

const WAIT_SLACK_MS = 300;



let warmMs = 0;
let ownMs = 0;
function ema(prev, v) {
  return prev ? prev * 0.6 + v * 0.4 : v;
}




export function noteWarmMs(ms) {
  if (ms > 0) warmMs = ema(warmMs, ms);
}


function waitBudget(ent) {
  const exp = warmMs || WARM_MS_GUESS;
  const self = ownMs || OWN_MS_GUESS;
  const elapsed = ent.startedAt ? Date.now() - ent.startedAt : 0;
  const remain = exp - elapsed;
  
  if (remain > self) return 0;
  
  
  return Math.max(200, Math.min(self, remain + WAIT_SLACK_MS));
}

let bytes = 0; 
let budget = 0; 
let hits = 0; 
let missLogged = false; 
let missKind = ''; 


let missWant = NaN; 
let missTop = NaN; 



let waitAct = ''; 
let waitAge = 0; 
let waitMs = 0; 


export function resetSegHits() {
  hits = 0;
  missLogged = false;
  missKind = '';
  missWant = NaN;
  missTop = NaN;
  waitAct = '';
  waitAge = 0;
  waitMs = 0;
  resetRangeLog();
}

export function segHits() {
  return hits;
}





export function segCount() {
  sweep();
  return store.size;
}

export function missNote() {
  return missKind;
}


export function missDetail() {
  return { want: missWant, top: missTop };
}


//



export function cachedSegNums(refUrl) {
  const ref = refUrl ? splitUrl(refUrl).dir : null;
  const out = [];
  for (const k of store.keys()) {
    const s = splitUrl(k);
    if (ref && s.dir !== ref) continue;
    const n = segNum(s.file);
    if (!isNaN(n)) out.push(n);
  }
  return out.sort((a, b) => a - b);
}


export function urlSegNum(url) {
  if (!url) return NaN;
  return segNum(splitUrl(url).file);
}




export function waitDiag() {
  return {
    act: waitAct,
    age: waitAge,
    budget: waitMs,
    warm: Math.round(warmMs || WARM_MS_GUESS),
    own: Math.round(ownMs || OWN_MS_GUESS),
    
    
    ownReal: ownMs > 0
  };
}


//




//



function segKey(url) {
  if (!url) return url;
  let u = url;
  const P = '/__proxy__?u=';
  if (u.indexOf(P) === 0) {
    try {
      u = decodeURIComponent(u.slice(P.length));
    } catch (e) {}
  }
  const q = u.indexOf('?');
  if (q < 0) return u;
  const path = u.slice(0, q);
  return /\.(ts|m4s|mp4|m4v|m4a|aac|mpg|mpeg)$/i.test(path) ? path : u;
}

function splitUrl(u) {
  const q = u.indexOf('?');
  const path = q < 0 ? u : u.slice(0, q);
  const i = path.lastIndexOf('/');
  return { dir: path.slice(0, i + 1), file: path.slice(i + 1) };
}



function segNum(file) {
  const m = file.match(/\d+/g);
  return m ? parseInt(m[m.length - 1], 10) : NaN;
}





//




function classifyMiss(want) {
  if (!store.size || !want) return '';
  const w = splitUrl(want);
  const wn = segNum(w.file);
  missWant = wn;
  let top = NaN; 
  for (const k of store.keys()) {
    const s = splitUrl(k);
    
    
    
    
    if (s.dir !== w.dir) continue;
    if (s.file === w.file) return 'x'; 
    const n = segNum(s.file);
    if (!isNaN(n) && (isNaN(top) || n > top)) top = n;
  }
  missTop = top;
  if (isNaN(top)) return 'w';
  if (isNaN(wn)) return 's';
  const diff = wn - top;
  return 's' + (diff > 0 ? '+' + diff : diff);
}

export function setSegBudget(n) {
  budget = n > 0 ? n : 0;
  if (!budget) clearSegCache();
  else trim();
}

export function segBudget() {
  return budget;
}

export function clearSegCache() {
  store.clear();
  bytes = 0;
}


function sweep() {
  const now = Date.now();
  for (const [k, e] of store) {
    if (now - e.at > TTL_MS) {
      store.delete(k);
      bytes -= e.buf.byteLength;
    }
  }
  if (bytes < 0) bytes = 0;
}


function trim() {
  sweep();
  while (bytes > budget && store.size) {
    const k = store.keys().next().value;
    const e = store.get(k);
    store.delete(k);
    bytes -= e ? e.buf.byteLength : 0;
  }
  if (bytes < 0) bytes = 0;
}




export function putSeg(url, buf, ms) {
  if (!budget || !url || !buf || !buf.byteLength) return;
  if (buf.byteLength > budget) return;
  const k = segKey(url);
  takeSeg(k); 
  store.set(k, { buf, ms: ms > 0 ? ms : 1, at: Date.now() });
  bytes += buf.byteLength;
  trim();
}




export function setPending(url, p, info) {
  const k = segKey(url);
  if (!p) {
    pending.delete(k);
    return;
  }
  const ent = {
    p,
    startedAt: (info && info.startedAt) || Date.now(),
    abort: info && info.abort
  };
  pending.set(k, ent);
  const clear = () => {
    if (pending.get(k) === ent) pending.delete(k);
  };
  p.then(clear, clear);
}



export function pendingSeg(url) {
  return pending.has(segKey(url));
}



export function hasSeg(url) {
  const e = store.get(segKey(url));
  return !!e && Date.now() - e.at <= TTL_MS;
}


export function takeSeg(url) {
  const k = segKey(url);
  const e = store.get(k);
  if (!e) return null;
  store.delete(k);
  bytes -= e.buf.byteLength;
  if (bytes < 0) bytes = 0;
  if (Date.now() - e.at > TTL_MS) return null;
  return e;
}




export function makeCachedFragLoader(Base) {
  return class CachedFragLoader extends Base {
    load(context, config, callbacks) {
      if (this._cancelled || (this._loadState && this._loadState.done)) return;
      
      if (!this._loadState) this._loadState = { context, callbacks, done: false };
      this.context = context;
      
      const ranged = context && (context.rangeStart || context.rangeEnd);
      const hit = ranged ? null : takeSeg(context && context.url);
      if (!hit) {
        
        
        
        const k = ranged ? null : segKey(context && context.url);
        const ent = k ? pending.get(k) : null;
        if (ent) {
          const budgetMs = waitBudget(ent);
          const age = ent.startedAt ? Date.now() - ent.startedAt : 0;
          if (!waitAct) {
            waitAge = age;
            waitMs = budgetMs;
          }
          try {
            console.log(
              '[warm] in flight ' + age + 'ms warm~' + Math.round(warmMs || WARM_MS_GUESS) +
                ' own~' + Math.round(ownMs || OWN_MS_GUESS) + ' → ' +
                (budgetMs ? 'wait ' + budgetMs + 'ms' : 'take over') + ' ' + redactUrl(context.url)
            );
          } catch (e) {}
          if (!budgetMs) {
            
            
            if (!waitAct) waitAct = 'over';
            pending.delete(k);
            if (ent.abort) { try { ent.abort(); } catch (e) {} }
          } else {
            this._waiting = true;
            let settled = false;
            const resume = (giveUp) => {
              if (settled) return;
              settled = true;
              clearTimeout(this._waitTimer);
              this._waitTimer = null;
              if (!this._waiting || this._cancelled) return; 
              if (pending.get(k) === ent) pending.delete(k);
              this._waiting = false;
              if (!waitAct) waitAct = giveUp ? 'give' : 'wait';
              if (giveUp) {
                try { console.log('[warm] give up waiting ' + redactUrl(context.url)); } catch (e) {}
                
                if (ent.abort) { try { ent.abort(); } catch (e) {} }
              }
              this.load(context, config, callbacks); 
            };
            this._waitTimer = setTimeout(() => resume(true), budgetMs);
            ent.p.then(() => resume(false), () => resume(false));
            return;
          }
        }
        
        
        
        if (!missLogged) {
          missLogged = true;
          missKind = classifyMiss(context && context.url);
          try {
            console.log(
              '[warm] MISS(' +
                missKind +
                ') want=' +
                redactUrl(context && context.url) +
                ' have=' +
                JSON.stringify([...store.keys()].map(redactUrl))
            );
          } catch (e) {}
        }
        
        
        if (!ranged && this._tryRange(context, config, callbacks)) return;
        this._loadSelf(context, config, callbacks);
        return;
      }
      const st = this.stats;
      const now = self.performance.now();
      hits++;
      try { console.log('[warm] HIT ' + redactUrl(context.url)); } catch (e) {}
      st.loading.start = now - hit.ms; 
      st.loading.first = st.loading.start + 1;
      st.loading.end = now;
      st.loaded = st.total = hit.buf.byteLength;
      st.chunkCount = 1;
      st.bwEstimate = (hit.buf.byteLength * 8000) / hit.ms;
      
      this._hitTimer = setTimeout(() => {
        this._hitTimer = null;
        if (this._cancelled || this._loadState.done) return;
        this._loadState.done = true;
        callbacks.onSuccess(
          { url: context.url, data: hit.buf },
          st,
          context,
          null
        );
      }, 0);
    }

    abort() {
      const state = this._loadState;
      const notify = state && !state.done;
      const stats = this.stats;
      
      if (state) state.done = true;
      if (notify) stats.aborted = true;
      this._clearHit();
      
      if (notify) state.aborting = true;
      try {
        super.abort();
      } finally {
        if (notify) state.aborting = false;
      }
      if (notify && state.callbacks.onAbort) {
        state.callbacks.onAbort(...(state.abortArgs || [stats, state.context, null]));
      }
    }

    destroy() {
      
      if (this._loadState) this._loadState.done = true;
      this._clearHit();
      super.destroy();
    }

    
    //
    
    
    
    
    //
    
    _loadSelf(context, config, callbacks) {
      const state = this._loadState;
      if (this._cancelled || state.done) return;
      const cb = {};
      for (const key in callbacks) {
        const orig = callbacks[key];
        cb[key] = typeof orig !== 'function' ? orig : (...args) => {
          if (key === 'onAbort' && state.aborting) {
            if (!state.abortArgs) state.abortArgs = args;
            return;
          }
          if (this._cancelled || state.done) return;
          if (key === 'onSuccess' || key === 'onError' || key === 'onTimeout' || key === 'onAbort') {
            state.done = true;
          }
          if (key === 'onSuccess') {
            try {
              const l = args[1] && args[1].loading;
              const ms = l ? l.end - l.start : 0;
              if (ms > 0) ownMs = ema(ownMs, ms);
            } catch (e) {}
          }
          return orig(...args);
        };
      }
      super.load(context, config, cb);
    }

    
    
    
    _tryRange(context, config, callbacks) {
      
      
      const to =
        config && config.loadPolicy ? config.loadPolicy.maxLoadTimeMs : config && config.timeout;
      const started = self.performance.now();
      const job = rangeLoad(context && context.url, to);
      if (!job) return false;
      this.context = context;
      this._rangeJob = job;
      job.promise.then((res) => {
        if (this._cancelled || this._rangeJob !== job) return;
        this._rangeJob = null;
        if (!res) {
          
          const elapsed = Math.max(0, self.performance.now() - started);
          const remaining = Number.isFinite(to) && to > 0 ? Math.max(0, to - elapsed) : to;
          if (remaining === 0 && to > 0) {
            const st = this.stats;
            st.loading.start = started;
            st.aborted = true;
            
            this._loadState.done = true;
            callbacks.onTimeout(st, context, null);
            return;
          }
          
          const fallback = { ...config };
          if (Number.isFinite(remaining) && remaining > 0) {
            fallback.timeout = remaining;
            if (config.loadPolicy) {
              const first = config.loadPolicy.maxTimeToFirstByteMs;
              fallback.loadPolicy = {
                ...config.loadPolicy,
                maxLoadTimeMs: remaining,
                
                maxTimeToFirstByteMs: first > 0 && Number.isFinite(first)
                  ? Math.min(first, remaining) : remaining
              };
            }
          } else if (config && config.loadPolicy) {
            fallback.loadPolicy = { ...config.loadPolicy };
          }
          this._loadSelf(context, fallback, callbacks);
          return;
        }
        const st = this.stats;
        const now = self.performance.now();
        
        
        if (res.ms > 0) ownMs = ema(ownMs, res.ms);
        st.loading.start = now - res.ms;
        st.loading.first = st.loading.start + res.ttfb;
        st.loading.end = now;
        st.loaded = st.total = res.buf.byteLength;
        st.chunkCount = 1;
        
        
        st.bwEstimate = (res.buf.byteLength * 8000) / res.ms;
        
        this._loadState.done = true;
        callbacks.onSuccess({ url: context.url, data: res.buf }, st, context, null);
      });
      return true;
    }

    _clearHit() {
      this._cancelled = true;
      this._waiting = false; 
      if (this._waitTimer) {
        clearTimeout(this._waitTimer);
        this._waitTimer = null;
      }
      if (this._hitTimer) {
        clearTimeout(this._hitTimer);
        this._hitTimer = null;
      }
      
      
      
      if (this._rangeJob) {
        const j = this._rangeJob;
        this._rangeJob = null;
        j.abort();
      }
    }
  };
}
