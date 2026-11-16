

//





import { PcmStore, Wsola } from './pcm.js';
import { adtsHeader } from './isobmff.js';
import { Mp2Decoder, parseMpegHeader } from './mp2.js';

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

let sharedCtx = null;


export function getAudioContext() {
  if (sharedCtx) return sharedCtx;
  const C = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!C) return null;
  try {
    sharedCtx = new C({ latencyHint: 'playback' });
  } catch (e) {
    try {
      sharedCtx = new C();
    } catch (e2) {
      sharedCtx = null;
    }
  }
  return sharedCtx;
}


export function primeAudio() {
  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}






export async function detectAudioPath() {
  if (typeof window === 'undefined' || !(window.AudioContext || window.webkitAudioContext)) {
    return { ok: false, reason: 'no-webaudio' };
  }
  if (typeof window.AudioDecoder === 'function' && typeof window.EncodedAudioChunk === 'function') {
    try {
      const r = await window.AudioDecoder.isConfigSupported({
        codec: 'mp4a.40.2',
        sampleRate: 44100,
        numberOfChannels: 2
      });
      if (r && r.supported) return { ok: true, path: 'webcodecs' };
    } catch (e) {}
  }
  return { ok: true, path: 'decodeaudio' };
}

function decodeAudio(ctx, ab) {
  return new Promise((resolve, reject) => {
    
    const p = ctx.decodeAudioData(ab, resolve, reject);
    if (p && p.catch) p.catch(reject);
  });
}


function copyPlanes(ad) {
  const n = ad.numberOfFrames;
  const ch = ad.numberOfChannels;
  const out = [];
  try {
    for (let c = 0; c < ch; c++) {
      const f = new Float32Array(n);
      ad.copyTo(f, { planeIndex: c, format: 'f32-planar' });
      out.push(f);
    }
    return out;
  } catch (e) {
    out.length = 0;
  }
  const fmt = String(ad.format || 'f32');
  const planar = fmt.indexOf('planar') > 0;
  const kind = fmt.slice(0, 3);
  const Ctor = kind === 's16' ? Int16Array : kind === 's32' ? Int32Array : kind === 'u8' || kind === 'u8-' ? Uint8Array : Float32Array;
  const conv = (v) =>
    kind === 's16' ? v / 32768 : kind === 's32' ? v / 2147483648 : Ctor === Uint8Array ? (v - 128) / 128 : v;
  if (planar) {
    for (let c = 0; c < ch; c++) {
      const raw = new Ctor(n);
      ad.copyTo(raw, { planeIndex: c });
      const f = new Float32Array(n);
      for (let i = 0; i < n; i++) f[i] = conv(raw[i]);
      out.push(f);
    }
    return out;
  }
  const raw = new Ctor(n * ch);
  ad.copyTo(raw, { planeIndex: 0 });
  for (let c = 0; c < ch; c++) {
    const f = new Float32Array(n);
    for (let i = 0; i < n; i++) f[i] = conv(raw[i * ch + c]);
    out.push(f);
  }
  return out;
}

const TICK_MS = 50;
const AHEAD = 0.35; 
const HOPS = 4; 
const MP2_SLICE_MS = 8; 
const MP2_BAD_JOBS = 3; 

export class AudioPipeline {
  








  constructor(o) {
    this.video = o.video;
    this.S = o.speed;
    this.path = o.path;
    this.realTime = o.realTime;
    this.onFail = o.onFail || null;
    this.onEvict = o.onEvict || null;
    this.ctx = getAudioContext();
    this.store = new PcmStore();
    this.wsola = new Wsola(this.store, this.S);
    this.info = null;
    this.dec = null;
    this.cfgKey = '';
    this._tail = null;
    this.running = false;
    this.nodes = [];
    this.gain = null;
    this.nextWhen = 0;
    this.offs = [];
    this.hist = [];
    this._stalled = false;
    this.dead = false;
    this.mp2 = null;
    this._mpQ = [];
    this._mpTimer = 0;
    this._mpNext = null;
    this._mpBad = 0;
    this.stats = { path: o.path, decoded: 0, decErrors: 0, restarts: 0, underruns: 0, drift: 0, measured: 0, played: 0 };

    const halt = () => this._halt(true);
    this._ev = {
      seeking: halt,
      pause: halt,
      waiting: () => {
        this._stalled = true;
        this._halt(true);
      },
      playing: () => {
        this._stalled = false;
      }
    };
    for (const k in this._ev) this.video.addEventListener(k, this._ev[k]);
    this._timer = setInterval(() => this._tick(), TICK_MS);
  }

  

  setInit(info) {
    this.info = info;
    const key = [info.codec, info.sampleRate, info.channels, Array.prototype.join.call(info.asc || [], ',')].join('|');
    if (key === this.cfgKey) return;
    this.cfgKey = key;
    this._closeDecoder();
    this._clearMpeg();
    this._tail = null;
    this.stats.path = info.codec === 'mpeg' ? 'mp2' : this.path;
  }

  
  push(samples, timescale, offset) {
    if (this.dead || !this.info || !samples.length || !timescale) return;
    if (this.info.codec === 'mpeg') this._queueMpeg(samples, timescale, offset);
    else if (this.path === 'webcodecs') this._decodeWebCodecs(samples, timescale, offset);
    else this._decodeAdts(samples, timescale, offset);
  }

  remove(a, b) {
    this.store.removeSec(a, b);
    this._tail = null;
    const q = this._mpQ;
    const kept = q.filter((j) => {
      const mid = (j.t0 + j.t1) / 2;
      return mid < a || mid >= b;
    });
    if (kept.length !== q.length) {
      this._mpQ = kept;
      
      this._mpNext = null;
    }
  }

  

  _queueMpeg(samples, ts, off) {
    const h = parseMpegHeader(samples[0].data, 0);
    
    if (h && (h.version !== 3 || h.layer !== 2)) {
      if (this.onFail) this.onFail('audio-codec');
      return;
    }
    const last = samples[samples.length - 1];
    this._mpQ.push({ t0: samples[0].t / ts + off, t1: (last.t + last.d) / ts + off, samples, i: 0, planes: null, sr: 0, bad: 0 });
    if (!this._mpTimer) this._mpTimer = setTimeout(() => this._pumpMpeg(), 0);
  }

  _pumpMpeg() {
    this._mpTimer = 0;
    if (this.dead) return;
    const start = now();
    const q = this._mpQ;
    while (q.length && now() - start < MP2_SLICE_MS) {
      const job = q[0];
      if (!job.planes) this._startMpegJob(job);
      const dec = this.mp2;
      const [L, R] = job.planes;
      const n = job.samples.length;
      while (job.i < n) {
        if (!dec.decode(job.samples[job.i].data, L, R, job.i * 1152)) job.bad++;
        job.i++;
        if (now() - start >= MP2_SLICE_MS) break;
      }
      if (job.i < n) break;
      q.shift();
      this._finishMpegJob(job);
    }
    if (q.length && !this.dead) this._mpTimer = setTimeout(() => this._pumpMpeg(), 0);
  }

  _startMpegJob(job) {
    if (!this.mp2) this.mp2 = new Mp2Decoder();
    if (this._mpNext == null || Math.abs(job.t0 - this._mpNext) > 0.05) this.mp2.reset();
    this._mpNext = job.t1;
    const h = parseMpegHeader(job.samples[0].data, 0);
    job.sr = (h && h.sampleRate) || this.info.sampleRate || 48000;
    const n = job.samples.length * 1152;
    job.planes = [new Float32Array(n), new Float32Array(n)];
  }

  _finishMpegJob(job) {
    
    this.stats.decErrors += job.bad;
    if (job.bad * 2 > job.samples.length) {
      if (++this._mpBad >= MP2_BAD_JOBS && this.onFail) this.onFail('audio-decode');
      return;
    }
    this._mpBad = 0;
    this.store.insert(job.t0, job.planes, job.sr);
    this.stats.decoded += job.samples.length;
  }

  _clearMpeg() {
    this._mpQ = [];
    this._mpNext = null;
    this._mpBad = 0;
    if (this._mpTimer) clearTimeout(this._mpTimer);
    this._mpTimer = 0;
  }

  _decoder() {
    if (this.dec && this.dec.state !== 'closed') return this.dec;
    const info = this.info;
    const dec = new window.AudioDecoder({
      output: (ad) => this._onAudioData(ad),
      
      error: (e) => {
        if (this.dec === dec) this._onDecodeError(e);
      }
    });
    dec.configure({
      codec: info.codec,
      sampleRate: info.sampleRate,
      numberOfChannels: info.channels,
      description: info.asc
    });
    this.dec = dec;
    return dec;
  }

  _decodeWebCodecs(samples, ts, off) {
    try {
      
      
      
      const t0 = samples[0].t / ts + off;
      if (this.dec && this._nextTs != null && Math.abs(t0 - this._nextTs) > 0.05) this._retireDecoder();
      const dec = this._decoder();
      for (const s of samples) {
        dec.decode(
          new window.EncodedAudioChunk({
            type: 'key',
            timestamp: Math.round((s.t / ts + off) * 1e6),
            duration: Math.round((s.d / ts) * 1e6),
            data: s.data
          })
        );
      }
      const last = samples[samples.length - 1];
      this._nextTs = (last.t + last.d) / ts + off;
    } catch (e) {
      this._onDecodeError(e);
    }
  }

  _retireDecoder() {
    const old = this.dec;
    this.dec = null;
    const close = () => {
      try {
        if (old.state !== 'closed') old.close();
      } catch (e) {}
    };
    try {
      if (old.state === 'configured') old.flush().then(close, close);
      else close();
    } catch (e) {
      close();
    }
  }

  _onAudioData(ad) {
    try {
      if (this.dead) return;
      const planes = copyPlanes(ad);
      this.store.insert(ad.timestamp / 1e6, planes, ad.sampleRate);
      this.stats.decoded++;
    } catch (e) {
      this._onDecodeError(e);
    } finally {
      try {
        ad.close();
      } catch (e) {}
    }
  }

  




  _decodeAdts(samples, ts, off) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = samples[0].t / ts + off;
    const last = samples[samples.length - 1];
    const t1 = (last.t + last.d) / ts + off;
    const tail = this._tail && Math.abs(this._tail.end - t0) < 0.03 ? this._tail.frames : [];
    const frames = tail.concat(samples.map((s) => ({ data: s.data, dur: s.d / ts })));
    const preSec = tail.reduce((a, f) => a + f.dur, 0);
    this._tail = { end: t1, frames: frames.slice(-2).map((f) => ({ data: f.data.slice(), dur: f.dur })) };
    let total = 0;
    for (const f of frames) total += 7 + f.data.length;
    const buf = new Uint8Array(total);
    let p = 0;
    for (const f of frames) {
      buf.set(adtsHeader(this.info, f.data.length), p);
      buf.set(f.data, p + 7);
      p += 7 + f.data.length;
    }
    decodeAudio(ctx, buf.buffer).then(
      (ab) => {
        if (this.dead) return;
        const sr = ab.sampleRate;
        const skip = Math.round(preSec * sr);
        const n = Math.max(0, Math.min(ab.length - skip, Math.round((t1 - t0) * sr)));
        if (!n) return;
        const planes = [];
        for (let c = 0; c < ab.numberOfChannels; c++) planes.push(ab.getChannelData(c).slice(skip, skip + n));
        this.store.insert(t0, planes, sr);
        this.stats.decoded++;
      },
      (e) => this._onDecodeError(e)
    );
  }

  _onDecodeError() {
    if (this.dead) return;
    this.stats.decErrors++;
    this._closeDecoder();
    
    if (this.stats.decErrors >= 4 && this.onFail) this.onFail('audio-decode');
  }

  _closeDecoder() {
    this._nextTs = null;
    if (this.dec) {
      try {
        if (this.dec.state !== 'closed') this.dec.close();
      } catch (e) {}
      this.dec = null;
    }
  }

  

  _latency() {
    const ctx = this.ctx;
    const l = (ctx && (ctx.outputLatency || ctx.baseLatency)) || 0;
    return l > 0 && l < 0.3 ? l : 0;
  }

  _tick() {
    if (this.dead) return;
    const ctx = this.ctx;
    const v = this.video;
    if (!ctx) return;
    const m = this.realTime();
    const live = !v.paused && !v.seeking && !v.ended && v.readyState >= 3 && !this._stalled;
    this._measure(live, m);
    this._evict(m);
    if (!live || !this.store.sr) {
      this._halt(true);
      return;
    }
    if (ctx.state !== 'running') {
      
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      this._halt(true);
      return;
    }
    const now = ctx.currentTime;
    this.offs.push(m - now);
    if (this.offs.length > 10) this.offs.shift();
    
    if (this.offs.length < 4) return;
    const est = Math.max.apply(null, this.offs);
    const lat = this._latency();
    if (!this.running) {
      this._begin(now, est, lat);
    } else {
      const sr = this.store.sr;
      
      const want = (this.nextWhen + lat + est) * this.S;
      const drift = (this.wsola.pos / sr - want) / this.S; 
      this.stats.drift = drift;
      const starved = this.nextWhen < now + 0.005;
      if (starved || Math.abs(drift) > 0.25) {
        if (starved) this.stats.underruns++;
        this._halt(false);
        this._begin(now, est, lat);
      } else if (Math.abs(drift) > 0.03) {
        this.wsola.nudge(-drift * this.S * sr * 0.2);
      }
    }
    if (this.running) this._fill(now);
  }

  _begin(now, est, lat) {
    const ctx = this.ctx;
    const startAt = now + 0.08;
    const s = Math.round((startAt + lat + est) * this.S * this.store.sr);
    this.wsola.reset(s);
    if (!this.wsola.ready(HOPS)) return; 
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, startAt);
    g.gain.linearRampToValueAtTime(1, startAt + 0.03);
    g.connect(ctx.destination);
    this.gain = g;
    this.nextWhen = startAt;
    this.running = true;
    this.stats.restarts++;
  }

  _fill(now) {
    const ctx = this.ctx;
    const sr = this.store.sr;
    while (this.nextWhen - now < AHEAD) {
      const out = this.wsola.process(HOPS);
      if (!out) break;
      const len = out[0].length;
      const buf = ctx.createBuffer(out.length, len, sr);
      for (let c = 0; c < out.length; c++) {
        if (buf.copyToChannel) buf.copyToChannel(out[c], c);
        else buf.getChannelData(c).set(out[c]);
      }
      const node = ctx.createBufferSource();
      node.buffer = buf;
      node.connect(this.gain);
      node.start(this.nextWhen);
      node.onended = () => {
        const i = this.nodes.indexOf(node);
        if (i >= 0) this.nodes.splice(i, 1);
      };
      this.nodes.push(node);
      this.nextWhen += len / sr;
      this.stats.played += len / sr;
    }
  }

  
  _halt(resetClock) {
    if (resetClock) this.offs = [];
    if (!this.running) return;
    this.running = false;
    const ctx = this.ctx;
    const g = this.gain;
    const t = ctx.currentTime;
    try {
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + 0.02);
    } catch (e) {}
    for (const n of this.nodes) {
      try {
        n.stop(t + 0.03);
      } catch (e) {}
    }
    this.nodes = [];
    this.gain = null;
    setTimeout(() => {
      try {
        g.disconnect();
      } catch (e) {}
    }, 200);
  }

  
  _measure(live, m) {
    if (!live) {
      this.hist = [];
      return;
    }
    const w = Date.now() / 1000;
    const h = this.hist;
    h.push([w, m * this.S]);
    while (h.length > 2 && w - h[0][0] > 4) h.shift();
    const span = w - h[0][0];
    if (span >= 2) this.stats.measured = (h[h.length - 1][1] - h[0][1]) / span;
  }

  
  _evict(m) {
    if (this.store.seconds <= 150) return;
    const r = this.store.evictBefore(m * this.S - 20);
    if (r && this.onEvict) this.onEvict(r[0], r[1]);
  }

  destroy() {
    if (this.dead) return;
    this._halt(true);
    this.dead = true;
    clearInterval(this._timer);
    for (const k in this._ev) this.video.removeEventListener(k, this._ev[k]);
    this._closeDecoder();
    this._clearMpeg();
    this.store.reset();
  }
}
