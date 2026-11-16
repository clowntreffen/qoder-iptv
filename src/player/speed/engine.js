
//





//

import { toU8, hasMoov, rewriteVideoInit, parseAudioInit, parseFragments } from './isobmff.js';
import { splitMpegFrames } from './mp2.js';
import { AudioPipeline, detectAudioPath, primeAudio } from './audio.js';
import { makeRanges, scaleRanges, addRange, removeRange } from './ranges.js';

export { primeAudio };

const SHIM_KEYS = ['currentTime', 'duration', 'buffered', 'seekable', 'playbackRate', 'defaultPlaybackRate'];

function protoDesc(name) {
  return typeof HTMLMediaElement !== 'undefined' ? Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, name) : null;
}

let capPromise = null;


export function detectSpeed() {
  if (capPromise) return capPromise;
  capPromise = (async () => {
    try {
      if (typeof window === 'undefined' || typeof window.MediaSource !== 'function') return { ok: false, reason: 'no-mse' };
      for (const k of SHIM_KEYS) {
        const d = protoDesc(k);
        if (!d || !d.get) return { ok: false, reason: 'no-shim' };
      }
      
      class Probe extends window.MediaSource {}
      new Probe();
      new EventTarget();
      const a = await detectAudioPath();
      if (!a.ok) return { ok: false, reason: a.reason };
      return { ok: true, path: a.path };
    } catch (e) {
      return { ok: false, reason: 'detect' };
    }
  })();
  return capPromise;
}


export function classify(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.indexOf('audio/') === 0) return 'audio';
  const mc = m.match(/codecs\s*=\s*"?([^";]*)/);
  const codecs = mc ? mc[1] : '';
  if (/mp4a|ac-3|ec-3|opus|flac|mp3/.test(codecs)) return 'muxed';
  return 'video';
}


class VideoSB {
  constructor(real, eng) {
    this.__real = real;
    this._eng = eng;
    if (typeof real.changeType === 'function') {
      this.changeType = (mime) => real.changeType(mime);
    }
  }
  get updating() {
    return this.__real.updating;
  }
  get buffered() {
    return scaleRanges(this.__real.buffered, this._eng.S);
  }
  get mode() {
    return this.__real.mode;
  }
  set mode(v) {
    this.__real.mode = v;
  }
  get timestampOffset() {
    return this.__real.timestampOffset * this._eng.S;
  }
  set timestampOffset(v) {
    this.__real.timestampOffset = v / this._eng.S;
  }
  get appendWindowStart() {
    return this.__real.appendWindowStart * this._eng.S;
  }
  set appendWindowStart(v) {
    this.__real.appendWindowStart = v / this._eng.S;
  }
  get appendWindowEnd() {
    return this.__real.appendWindowEnd * this._eng.S;
  }
  set appendWindowEnd(v) {
    this.__real.appendWindowEnd = v / this._eng.S;
  }
  appendBuffer(data) {
    let u8 = toU8(data);
    if (hasMoov(u8)) {
      const r = rewriteVideoInit(u8, this._eng.S);
      if (!r) {
        this._eng.fail('no-video');
      } else {
        
        if (Math.abs(r.scale / this._eng.S - 1) > 0.002) this._eng.fail('timescale');
        u8 = r.data;
      }
    }
    this.__real.appendBuffer(u8);
  }
  remove(a, b) {
    this.__real.remove(a / this._eng.S, b / this._eng.S);
  }
  abort() {
    this.__real.abort();
  }
  addEventListener(t, f, o) {
    this.__real.addEventListener(t, f, o);
  }
  removeEventListener(t, f, o) {
    this.__real.removeEventListener(t, f, o);
  }
  dispatchEvent(e) {
    return this.__real.dispatchEvent(e);
  }
}











export class FakeAudioSB extends EventTarget {
  constructor(eng, mime) {
    super();
    this._eng = eng;
    this.updating = false;
    this.timestampOffset = 0;
    this.appendWindowStart = 0;
    this.appendWindowEnd = Infinity;
    this._ranges = [];
    this._carry = null;
    this._info = null;
    this._gone = false;
    this._setMime(mime);
  }
  get buffered() {
    return makeRanges(this._ranges);
  }
  get timestampOffset() {
    return this._tso;
  }
  
  set timestampOffset(v) {
    this._tso = v;
    if (this.raw) this._carry = null;
  }
  _setMime(mime) {
    this.mime = mime;
    this.raw = /^audio\/mpeg/i.test(mime);
    this.mode = this.raw ? 'sequence' : 'segments';
    this._carry = null;
    if (!this.raw && !/^audio\/mp4/i.test(mime)) this._eng.fail('audio-codec');
  }
  changeType(mime) {
    this._setMime(mime);
  }
  _run(job) {
    if (this.updating) {
      const e = new Error('SourceBuffer is updating');
      e.name = 'InvalidStateError';
      throw e;
    }
    this.updating = true;
    setTimeout(() => {
      this.dispatchEvent(new Event('updatestart'));
      try {
        if (!this._gone && !this._eng.dead) job();
      } catch (err) {
        
        this._eng.fail('audio-parse');
      }
      this.updating = false;
      this.dispatchEvent(new Event('update'));
      this.dispatchEvent(new Event('updateend'));
    }, 0);
  }
  appendBuffer(data) {
    let u8 = toU8(data);
    
    u8 = this._carry ? concat(this._carry, u8) : u8.slice();
    this._carry = null;
    this._run(() => (this.raw ? this._appendRaw(u8) : this._append(u8)));
  }
  _appendRaw(u8) {
    const eng = this._eng;
    const { frames, rest } = splitMpegFrames(u8);
    this._carry = rest;
    if (!frames.length) return;
    const h = frames[0].h;
    if (h.version !== 3 || h.layer !== 2) {
      eng.fail('audio-codec');
      return;
    }
    const sr = h.sampleRate;
    eng.audio.setInit({ codec: 'mpeg', sampleRate: sr, channels: h.channels, timescale: sr, asc: null });
    const samples = [];
    let t = 0;
    for (const f of frames) {
      samples.push({ t, d: f.h.samples, data: f.data });
      t += f.h.samples;
    }
    const off = this._tso;
    const end = off + t / sr;
    eng.audio.push(samples, sr, off);
    this._ranges = addRange(this._ranges, off, end, 0.05);
    this._tso = end;
  }
  _append(u8) {
    const eng = this._eng;
    if (hasMoov(u8)) {
      const info = parseAudioInit(u8);
      if (!info || !info.codec) {
        eng.fail('audio-codec');
        return;
      }
      this._info = info;
      eng.audio.setInit(info);
      
      if (!readsMoof(u8)) return;
    }
    const info = this._info;
    if (!info) return;
    const { samples, rest } = parseFragments(u8, info);
    if (rest && readsMoof(rest)) this._carry = rest;
    if (!samples.length) return;
    const ts = info.timescale;
    const off = this.timestampOffset;
    const last = samples[samples.length - 1];
    const a = samples[0].t / ts + off;
    const b = (last.t + last.d) / ts + off;
    eng.audio.push(samples, ts, off);
    this._ranges = addRange(this._ranges, a, b, 0.05);
  }
  remove(a, b) {
    this._run(() => {
      this._eng.audio.remove(a, b);
      this._ranges = removeRange(this._ranges, a, b);
    });
  }
  abort() {
    this._carry = null;
  }
  
  _evicted(a, b) {
    this._ranges = removeRange(this._ranges, a, b + 0.001);
  }
  _detach() {
    this._gone = true;
    this._ranges = [];
    this._carry = null;
  }
}

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}


function readsMoof(u8) {
  for (let p = 0; p + 8 <= u8.length; ) {
    const size = ((u8[p] << 24) | (u8[p + 1] << 16) | (u8[p + 2] << 8) | u8[p + 3]) >>> 0;
    if (u8[p + 4] === 0x6d && u8[p + 5] === 0x6f && u8[p + 6] === 0x6f && u8[p + 7] === 0x66) return true;
    if (size < 8) return false;
    p += size;
  }
  return false;
}

export class SpeedEngine {
  




  constructor(video, speed, path) {
    this.video = video;
    this.S = speed;
    this.path = path;
    this.dead = false;
    this.failed = '';
    this.onFail = null;
    this.audioSB = null;
    const ct = protoDesc('currentTime');
    this._realTime = () => ct.get.call(video);
    this.audio = new AudioPipeline({
      video,
      speed,
      path,
      realTime: this._realTime,
      onFail: (r) => this.fail(r),
      onEvict: (a, b) => this.audioSB && this.audioSB._evicted(a, b)
    });
    this.MediaSourceClass = this._makeMS();
    this._q0 = this._quality();
    this._install();
  }

  
  attach(hls) {
    const orig = hls.attachMedia;
    hls.attachMedia = (...args) => this.withMediaSource(() => orig.apply(hls, args));
  }

  withMediaSource(fn) {
    const w = window;
    const prev = w.MediaSource;
    w.MediaSource = this.MediaSourceClass;
    try {
      return fn();
    } finally {
      w.MediaSource = prev;
    }
  }

  _makeMS() {
    const eng = this;
    const Base = window.MediaSource;
    return class SpeedMediaSource extends Base {
      addSourceBuffer(mime) {
        const kind = classify(mime);
        if (kind === 'audio') return eng._createAudioSB(mime);
        const real = super.addSourceBuffer(mime);
        if (kind === 'muxed') {
          eng.fail('muxed');
          return real;
        }
        return new VideoSB(real, eng);
      }
      removeSourceBuffer(sb) {
        if (sb instanceof FakeAudioSB) {
          sb._detach();
          if (eng.audioSB === sb) eng.audioSB = null;
          return;
        }
        return super.removeSourceBuffer(sb && sb.__real ? sb.__real : sb);
      }
      get duration() {
        return super.duration * eng.S;
      }
      set duration(v) {
        super.duration = v / eng.S;
      }
    };
  }

  _createAudioSB(mime) {
    if (this.audioSB) this.audioSB._detach();
    
    this.audio.remove(0, Infinity);
    this.audioSB = new FakeAudioSB(this, mime);
    return this.audioSB;
  }

  
  _install() {
    const v = this.video;
    const S = this.S;
    const d = {};
    for (const k of SHIM_KEYS) d[k] = protoDesc(k);
    
    try {
      d.playbackRate.set.call(v, 1);
      d.defaultPlaybackRate.set.call(v, 1);
    } catch (e) {}
    const def = (k, get, set) => Object.defineProperty(v, k, { configurable: true, enumerable: true, get, set });
    def(
      'currentTime',
      () => d.currentTime.get.call(v) * S,
      (t) => d.currentTime.set.call(v, t / S)
    );
    def('duration', () => d.duration.get.call(v) * S, undefined);
    def('buffered', () => scaleRanges(d.buffered.get.call(v), S), undefined);
    def('seekable', () => scaleRanges(d.seekable.get.call(v), S), undefined);
    
    def('playbackRate', () => S, () => {});
    def('defaultPlaybackRate', () => S, () => {});
    this._shimmed = true;
  }

  _uninstall() {
    if (!this._shimmed) return;
    for (const k of SHIM_KEYS) delete this.video[k];
    this._shimmed = false;
  }

  
  fail(reason) {
    if (this.failed || this.dead) return;
    this.failed = reason;
    setTimeout(() => {
      if (!this.dead && this.onFail) this.onFail(reason);
    }, 0);
  }

  _quality() {
    try {
      const q = this.video.getVideoPlaybackQuality && this.video.getVideoPlaybackQuality();
      if (q) return { total: q.totalVideoFrames, dropped: q.droppedVideoFrames };
    } catch (e) {}
    return null;
  }

  
  stats() {
    const s = Object.assign({ speed: this.S }, this.audio.stats);
    const q = this._quality();
    if (q && this._q0) {
      const total = q.total - this._q0.total;
      s.dropped = total > 0 ? (q.dropped - this._q0.dropped) / total : 0;
    }
    return s;
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    this.audio.destroy();
    if (this.audioSB) this.audioSB._detach();
    this.audioSB = null;
    this._uninstall();
  }
}
