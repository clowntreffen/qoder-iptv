
import Hls from 'hls.js';
import { proxied, resolveMediaUrl, isRemuxUrl } from '../core/net.js';
import { rememberHeaders, headersFor, applyHeaders, withHeaders } from '../core/reqHeaders.js';
import { t } from '../core/i18n.js';
import { redactUrl } from '../core/util.js';
import { toHlsConfig, getTuning } from './tuning.js';
import {
  setSegBudget,
  putSeg,
  makeCachedFragLoader,
  resetSegHits,
  segHits,
  segCount,
  hasSeg,
  pendingSeg,
  setPending,
  noteWarmMs,
  missNote,
  missDetail,
  waitDiag,
  cachedSegNums,
  urlSegNum
} from './fragCache.js';
import { setRangeLanes, rangeLanes, rangeLoad, warmLanes } from './rangeLoad.js';
import { makeVodPlaylistLoader } from './vodPlaylist.js';
import { SpeedEngine, detectSpeed, primeAudio } from './speed/engine.js';
import { pickSavedTrack } from '../core/channelTracks.js';


// Direct .m3u8 URLs and reverse-proxy URLs whose `url=`/`u=` target ends in
// .m3u8 both need hls.js; the path alone is not enough for proxied playlists.
export function isHlsUrl(raw) {
  return /\.m3u8(\?|$)/i.test(raw) ||
    /[?&](?:url|u)=[^&]*\.m3u8(?:[?&#]|$)/i.test(raw);
}

const CFG = {
  maxErrorRetries: 8,
  networkRetry: {
    delays: [1000, 2000, 4000, 8000, 15000, 15000, 15000, 15000]
  },
  
  
  
  nativeRetry: {
    max: 2,
    delayMs: 1200, 
    windowMs: 30000 
  },
  
  
  
  nativeBreaker: 2,
  nativeCacheMax: 128, 
  prefetchCacheMax: 48, 
  startup: {
    pollMs: 200,
    timeoutMs: 15000,
    stallMs: 1000,
    minBuffer: 2,
    boundaryTolerance: 0.05,
    nudge: 0.05,
    motion: 0.1
  },
  warmSafety: {
    segmentFactor: 1.5, 
    targetFraction: 0.8, 
    downloadFactor: 2, 
    downloadSlack: 2,
    downloadDecay: 0.8 
  },
  hls: {
    lowLatencyMode: false,
    startFragPrefetch: true, 
    testBandwidth: false, 
    abrEwmaDefaultEstimate: 1500000, 
    
    
    
    //
    
    
    
    //
    
    
    
    
    
    
    
    //
    
    
    liveSyncDuration: 22,
    
    startOnSegmentBoundary: true,
    maxBufferLength: 30,
    backBufferLength: 30,
    manifestLoadingTimeOut: 16000,
    manifestLoadingMaxRetry: 2,
    manifestLoadingRetryDelay: 500,
    fragLoadingTimeOut: 15000,
    fragLoadingMaxRetry: 3,
    fragLoadingRetryDelay: 500
  }
};



//




const WARM_REDO_MS = 8000;


//






const WARM_SEG_MAX = 2;


//





const ALIGN_LAG_SEG = 4;


//





const WARM_TOTAL_MAX = 192 * 1024 * 1024;


//



//


const WARM_LEAD = 1;




const WARM_JOB_TTL = 40000;





const WARM_LOAD_TIMEOUT = 35000;
const WARM_MANIFEST_TIMEOUT = 4000;

//
// Cold remux manifests answer immediately, but the first segment can take
// up to ~30s while the server starts ffmpeg. Budgets must cover that.
//
const REMUX_STARTUP_TIMEOUT_MS = 40000;
const REMUX_FRAG_TIMEOUT_MS = 35000;
const REMUX_MANIFEST_TIMEOUT_MS = 30000;
const REMUX_FRAG_MAX_RETRY = 5;
const REMUX_FRAG_RETRY_DELAY_MS = 1000;
const PREWARM_DEDUPE_MS = 15000;
const PREWARM_TIMEOUT_MS = 5000;


const RATE_APPLY_MS = 600;

function clampRate(r) {
  const n = Number(r);
  if (!isFinite(n) || n <= 0) return 1;
  return Math.min(4, Math.max(0.25, Math.round(n * 100) / 100));
}


function boundedSet(map, key, val, max) {
  if (map.has(key)) map.delete(key);
  else if (map.size >= max) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, val);
}



async function readCapped(reader, cap, ctl, enabled) {
  const parts = [];
  let n = 0;
  let finished = false;
  const cancel = () => cancelWarmBody(reader);
  if (ctl) ctl.signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      checkWarmAbort(ctl, enabled());
      const { done, value } = await reader.read();
      checkWarmAbort(ctl, enabled());
      if (done) {
        finished = true;
        const out = new Uint8Array(n);
        let offset = 0;
        for (const part of parts) {
          out.set(part, offset);
          offset += part.byteLength;
        }
        return out.buffer;
      }
      n += value.byteLength;
      if (n > cap) {
        if (ctl) ctl.abort();
        return null;
      }
      parts.push(value);
    }
  } finally {
    if (ctl) ctl.signal.removeEventListener('abort', cancel);
    if (!finished) cancel();
    reader.releaseLock();
  }
}

function cancelWarmBody(body) {
  try { Promise.resolve(body && body.cancel()).catch(() => {}); } catch (e) {}
}

function checkWarmAbort(ctl, enabled = true) {
  if (!enabled && ctl) ctl.abort();
  if (!enabled || (ctl && ctl.signal.aborted)) throw new Error('warm aborted');
}



function boundedAdd(set, key, max) {
  if (set.has(key)) { set.delete(key); set.add(key); return; }
  if (set.size >= max) {
    const oldest = set.values().next().value;
    if (oldest !== undefined) set.delete(oldest);
  }
  set.add(key);
}

export class Player {
  constructor(videoEl) {
    this.video = videoEl;
    this.hls = null;
    this.mode = 'live'; // live | catchup
    this.current = null; // { channel, programme, url }
    this.mediaInfo = { width: 0, height: 0, videoCodec: '', audioCodec: '' };
    this.onError = null;
    this.onStateChange = null;
    this.onMediaInfo = null; 
    this.onNotice = null; 
    this.onDebug = null; // (type, info) => void, debug overlay events
    this.onTrackChange = null; // () => void, fired after an audio/subtitle change
    this._savedTracks = null;
    this._warmHold = true;
    this._nativeRetries = 0;
    this._nativeErrAt = 0;
    this._nativeReloadTimer = null;
    this._netRetryTimer = null;
    this._prewarmAt = new Map();
    this._prewarmCtl = new Map();
    
    
    
    this._nativeBad = new Set();
    this._nativeFails = 0;
    this._nativeOff = false;
    this._playedOnce = false;
    this._warmPlaying = false;
    this._warmGeneration = 0; 
    this._fragDuration = 0;
    this._fragLoadSec = 0;
    this._bufferEvent = '';
    this._warmTuning = getTuning();
    this._prefetched = new Map();
    this._warmTargets = new Map();
    this._warmRefresh = null;
    
    this.rate = 1;
    this.engine = null;
    this._appliedRate = 1;
    this._engineBlocked = ''; 
    this._speedCap = null;
    this._resumeAt = 0; 
    this._rateTimer = null;
    this.onRateFail = null;
    detectSpeed().then((c) => {
      this._speedCap = c;
    });

    this.video.addEventListener('error', () => {
      
      if (!this.current || !this.video.error ||
          (this._activePath === 'native' && this._startup && this._startup.failed)) return;
      
      if (this.engine) {
        this.engine.fail('media');
        return;
      }
      this._warmPlaying = false;
      this.holdWarm();
      
      if (this._activePath === 'native') {
        if (!this._playedOnce && this._nativeStartupFailed()) return;
        const err = this.video.error;
        const decoded = err && err.code === 3; 
        if (decoded) this._nativeMarkBad();
        if (this._retryNativeMediaError(err)) return;
        if (decoded) this._nativeCountFail(); 
      }
      if (this.hls && !this._triedNativeFallback && this._canNativeHls()) {
        if (this._fallbackToNative('media')) return;
      }
      this._sampleStartup();
      if (this._activePath === 'native' && this._startup) this._startup.failed = true;
      if (this.onError) this.onError(this._describeError());
    });
    
    ['loadedmetadata', 'resize', 'playing'].forEach((ev) => {
      this.video.addEventListener(ev, () => {
        this._readVideoSize();
        if (ev === 'loadedmetadata') this.applySavedTracks();
      });
    });
    ['playing', 'waiting', 'pause', 'ended'].forEach((ev) => {
      this.video.addEventListener(ev, () => {
        if (!this.current || !this._activePath || (this._startup && this._startup.failed)) return;
        if (ev === 'playing' && (this.video.readyState < 2 || this.video.paused)) return;
        if (ev === 'playing') {
          this._netRetries = 0;
          this._mediaRetries = 0;
          clearTimeout(this._netRetryTimer);
          this._netRetryTimer = null;
        }
        if (ev === 'playing' && this._activePath !== 'native') this._playedOnce = true;
        if (ev === 'playing') this._resumeAt = 0; 
        if (ev === 'playing') this._unmuteIfAllowed(); 
        if (ev === 'playing') this._mark('playing');
        this._warmPlaying = ev === 'playing';
        
        if ((ev === 'playing' || ev === 'waiting') && this._bufferEvent !== ev) {
          this._bufferEvent = ev;
          this._logBuffer(ev);
        }
        this._pumpWarm();
        if (this.onStateChange) this.onStateChange(ev);
      });
    });
    
    
    
    ['timeupdate', 'progress', 'seeking', 'seeked'].forEach((ev) => {
      this.video.addEventListener(ev, () => this._pumpWarm());
    });
    ['loadeddata', 'playing', 'waiting', 'seeking', 'seeked', 'timeupdate'].forEach((ev) => {
      this.video.addEventListener(ev, () => this._sampleStartup(ev));
    });
  }

  _watchStartup() {
    if (!this._phase || this._startup || !['hls', 'native'].includes(this._activePath)) return;
    const now = Date.now();
    const state = this._startup = {
      at: now, position: this.video.currentTime, stillAt: now, progress: 0, pausedMs: 0,
      reason: 'buffer', nudged: false, attempted: false, done: false
    };
    this._sampleStartup();
    if (state.done) return;
    if (typeof this.video.requestVideoFrameCallback === 'function') {
      this._startupFrame = this.video.requestVideoFrameCallback(() => {
        if (this._startup !== state) return;
        this._startupFrame = null;
        this._mark('frame');
      });
    }
    this._startupTimer = setInterval(() => this._sampleStartup(), CFG.startup.pollMs);
  }

  _clearStartup() {
    clearInterval(this._startupTimer);
    this._startupTimer = null;
    if (this._startupFrame != null && typeof this.video.cancelVideoFrameCallback === 'function') {
      this.video.cancelVideoFrameCallback(this._startupFrame);
    }
    this._startupFrame = null;
  }

  _sampleStartup(event) {
    const state = this._startup;
    const phase = this._phase;
    if (!state || state.done || !phase || !this._activePath) return;
    const native = this._activePath === 'native';
    if (!native && !this.hls) return;
    const v = this.video;
    const cfg = { ...CFG.startup, timeoutMs: this._startupTimeoutMs || CFG.startup.timeoutMs };
    const now = Date.now();
    const pos = v.currentTime;
    const delta = pos - state.position;
    const elapsed = (now - state.at) / 1000;
    const seeking = v.seeking || event === 'seeking' || event === 'seeked';
    if (v.readyState >= 2) this._mark('data');
    if (event === 'seeked') this._mark('seeked');
    
    if (seeking || v.paused || delta < 0 || delta > elapsed * Math.max(1, v.playbackRate) + 0.25) {
      state.progress = 0;
      state.stillAt = now;
    } else if (delta > 0) {
      state.progress += delta;
      state.stillAt = now;
    }
    state.position = pos;
    state.at = now;
    if (v.error || v.ended) {
      state.done = true;
      state.reason = v.error ? 'error' : 'timeout';
      this._clearStartup();
      return;
    }
    if (state.progress >= cfg.motion) {
      this._mark('motion');
      state.reason = 'moving';
      state.done = true;
      this._clearStartup();
      if (native) {
        this._playedOnce = true;
        if (this.onStateChange) this.onStateChange('startupmoving');
      }
      return;
    }
    if (native && v.paused && v.readyState >= 2) state.pausedMs += elapsed * 1000;
    if (now - (phase.native || phase.t0) - state.pausedMs >= cfg.timeoutMs) {
      state.done = true;
      state.reason = 'timeout';
      this._clearStartup();
      if (native && this.mode === 'live') {
        if (this._nativeStartupFailed()) return;
        state.failed = true;
        this.video.pause();
        if (this.onError) this.onError(t('toast.channelUnavailable'));
      }
      return;
    }
    const ahead = this._bufferAhead();
    state.reason = seeking ? 'seeking' : ahead < cfg.minBuffer ? 'buffer' : 'ready';
    
    
    if (native || this.mode !== 'live' || v.paused || seeking || v.readyState !== 2 ||
        ahead < cfg.minBuffer || state.attempted || now - state.stillAt < cfg.stallMs) return;
    const target = pos + cfg.nudge;
    const flights = this.hls.inFlightFragments || {};
    const dependency = ['main', 'audio'].some((type) => {
      const flight = flights[type];
      return flight && flight.frag && flight.frag.start <= pos &&
        !['IDLE', 'STOPPED', 'ENDED', 'ERROR'].includes(flight.state);
    });
    if (dependency) { state.reason = 'dependency'; return; }
    const buffered = v.buffered;
    if (!buffered.length) return;
    const start = buffered.start(0);
    if (pos < start || pos - start > cfg.boundaryTolerance || target >= buffered.end(0)) return;
    state.attempted = true;
    state.progress = 0;
    state.stillAt = now;
    try {
      v.currentTime = target;
      state.position = v.currentTime;
      state.nudged = true;
      state.reason = 'nudged';
      console.log('[startup] hls nudge ' + pos.toFixed(3) + ' -> ' + target.toFixed(3));
    } catch (e) {
      state.reason = 'ready';
    }
  }

  startupStatus() {
    const p = this._phase;
    const state = this._startup;
    if (!p || !state || !this._activePath) return null;
    const sinceStart = (value) => value ? Math.max(0, value - p.t0) : null;
    let ahead = this._bufferAhead();
    if (this._activePath === 'native') {
      try { if (!this.video.buffered || !this.video.buffered.length) ahead = null; }
      catch (e) { ahead = null; }
    }
    return {
      path: this._activePath, fallback: p.fallback || null, native: sinceStart(p.native),
      data: sinceStart(p.data), frame: sinceStart(p.frame), seeked: sinceStart(p.seeked),
      playing: sinceStart(p.playing), motion: sinceStart(p.motion),
      ahead, readyState: this.video.readyState, reason: state.reason, nudged: state.nudged
    };
  }

  
  _mark(name) {
    if (this._phase && !this._phase[name]) this._phase[name] = Date.now();
  }

  _dbg(type, info) {
    if (this.onDebug) this.onDebug(type, info);
  }

  setSavedTracks(track) {
    this._savedTracks = track && typeof track === 'object' ? track : null;
    this.applySavedTracks();
  }

  applySavedTracks() {
    const saved = this._savedTracks;
    if (!saved) return;
    const st = this.getTrackState();
    const audio = pickSavedTrack(st.audio, {
      index: saved.audioIndex,
      label: saved.audioLabel
    });
    if (audio != null && audio.index !== st.audioIndex) {
      if (this.hls) this.hls.audioTrack = audio.index;
      else {
        const tracks = this.video.audioTracks || [];
        for (let i = 0; i < tracks.length; i++) tracks[i].enabled = i === audio.index;
      }
      this._emitTrackChange();
    }
    const sub = pickSavedTrack(st.subtitles, {
      index: saved.subtitleIndex,
      label: saved.subtitleLabel
    });
    if (sub != null && sub.index !== st.subtitleIndex) {
      if (this.hls) {
        this.hls.subtitleTrack = sub.index;
        this.hls.subtitleDisplay = sub.index >= 0;
      } else {
        const tracks = this.video.textTracks || [];
        for (const track of st.subtitles) {
          tracks[track.index].mode = track.index === sub.index ? 'showing' : 'disabled';
        }
      }
      this._emitTrackChange();
    }
  }

  _emitTrackChange() {
    if (this.onTrackChange) this.onTrackChange();
  }

  
  
  startupPhases() {
    const p = this._phase;
    if (!p || !p.t0 || !p.playing) return null;
    
    
    
    if (this._activePath !== 'hls') return null;
    const seg = (end, start) => (end && start && end >= start ? end - start : 0);
    return {
      manifest: seg(p.manifest, p.t0),
      frag: seg(p.frag, p.manifest || p.t0),
      buffer: seg(p.buffered, p.frag || p.manifest || p.t0),
      render: seg(p.playing, p.buffered || p.frag || p.manifest || p.t0)
    };
  }

  _describeError() {
    const e = this.video.error;
    if (!e) return t('perr.generic');
    const map = {
      1: 'perr.aborted',
      2: 'perr.network',
      3: 'perr.decode',
      4: 'perr.srcUnsupported'
    };
    return t(map[e.code] || 'perr.generic');
  }

  
  _readVideoSize() {
    const w = this.video.videoWidth || 0;
    const h = this.video.videoHeight || 0;
    if (!w || !h) return; 
    if (w === this.mediaInfo.width && h === this.mediaInfo.height) return;
    this.mediaInfo.width = w;
    this.mediaInfo.height = h;
    if (!this.mediaInfo.audioCodec) this.mediaInfo.audioCodec = this._nativeAudioCodec();
    this._emitMediaInfo();
  }

  
  
  _nativeAudioCodec() {
    const list = this.video.audioTracks;
    if (!list || !list.length) return '';
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      const s = String((t && (t.label || t.language)) || '');
      if (/aac|ac-?3|mp[23]|dts|opus|dolby/i.test(s)) return s;
    }
    return '';
  }

  _emitMediaInfo() {
    if (this.onMediaInfo) this.onMediaInfo({ ...this.mediaInfo });
  }

  _resetMediaInfo() {
    this.mediaInfo = { width: 0, height: 0, videoCodec: '', audioCodec: '' };
    this._emitMediaInfo();
  }

  getMediaInfo() {
    return { ...this.mediaInfo };
  }

  _labelOf(track, index, kind) {
    if (!track) return kind + ' ' + (index + 1);
    const name = track.label || track.name || track.language || '';
    const lang = track.language && track.language !== name ? track.language : '';
    const base = name || lang || kind + ' ' + (index + 1);
    return lang && name ? base + ' (' + lang + ')' : base;
  }

  getTrackState() {
    if (this.hls) {
      const audio = this.hls.audioTracks || [];
      const subtitles = this.hls.subtitleTracks || [];
      const ai = Number.isInteger(this.hls.audioTrack) ? this.hls.audioTrack : audio.length ? 0 : -1;
      const si = Number.isInteger(this.hls.subtitleTrack) ? this.hls.subtitleTrack : -1;
      return {
        audio: audio.map((track, i) => ({ index: i, label: this._labelOf(track, i, 'Audio') })),
        audioIndex: ai,
        subtitles: subtitles.map((track, i) => ({ index: i, label: this._labelOf(track, i, 'Subtitle') })),
        subtitleIndex: si
      };
    }
    const nativeAudio = this.video.audioTracks || [];
    const audio = [];
    let audioIndex = -1;
    for (let i = 0; i < nativeAudio.length; i++) {
      const track = nativeAudio[i];
      audio.push({ index: i, label: this._labelOf(track, i, 'Audio') });
      if (track && track.enabled) audioIndex = i;
    }
    if (audioIndex < 0 && audio.length) audioIndex = 0;
    const text = this.video.textTracks || [];
    const subtitles = [];
    let subtitleIndex = -1;
    for (let i = 0; i < text.length; i++) {
      const track = text[i];
      if (!track || (track.kind !== 'subtitles' && track.kind !== 'captions')) continue;
      subtitles.push({ index: i, label: this._labelOf(track, i, 'Subtitle') });
      if (track.mode === 'showing') subtitleIndex = i;
    }
    return { audio, audioIndex, subtitles, subtitleIndex };
  }

  getDebugState() {
    const st = this.getTrackState();
    const audio = Number.isInteger(st.audioIndex) && st.audioIndex >= 0
      ? st.audio[st.audioIndex]
      : null;
    const sub = st.subtitleIndex >= 0
      ? st.subtitles.find((track) => track.index === st.subtitleIndex)
      : null;
    let level = '-';
    let bitrate = null;
    if (this.hls && this.hls.levels && this.hls.levels.length) {
      const li = Number.isInteger(this.hls.currentLevel) ? this.hls.currentLevel : -1;
      const lv = li >= 0 ? this.hls.levels[li] : null;
      if (lv) {
        level = String(li);
        bitrate = Number(lv.bitrate) || null;
      }
    }
    return {
      path: this.activePath(),
      readyState: this.video.readyState,
      paused: this.video.paused,
      position: this.video.currentTime || 0,
      ahead: this._bufferAhead(),
      level,
      bitrate,
      audioLabel: audio ? audio.label : '',
      subtitleLabel: sub ? sub.label : '',
      videoCodec: this.mediaInfo.videoCodec,
      audioCodec: this.mediaInfo.audioCodec,
      width: this.mediaInfo.width,
      height: this.mediaInfo.height,
      remux: isRemuxUrl(this._rawUrl),
      fragLoadSec: this._fragLoadSec
    };
  }

  cycleAudio(dir = 1) {
    const state = this.getTrackState();
    const n = state.audio.length;
    if (n < 2) return state;
    let idx = state.audioIndex;
    if (!Number.isInteger(idx) || idx < 0 || idx >= n) idx = dir > 0 ? -1 : 0;
    idx = (idx + dir + n) % n;
    if (this.hls) {
      this.hls.audioTrack = idx;
    } else {
      const tracks = this.video.audioTracks || [];
      for (let i = 0; i < tracks.length; i++) tracks[i].enabled = i === idx;
    }
    this._emitTrackChange();
    return this.getTrackState();
  }

  cycleSubtitle(dir = 1) {
    const state = this.getTrackState();
    const n = state.subtitles.length;
    if (!n) return state;
    const options = [-1, ...state.subtitles.map((t) => t.index)];
    let pos = options.indexOf(state.subtitleIndex);
    if (pos < 0) pos = 0;
    const next = options[(pos + dir + options.length) % options.length];
    if (this.hls) {
      this.hls.subtitleTrack = next;
      this.hls.subtitleDisplay = next >= 0;
    } else {
      const tracks = this.video.textTracks || [];
      for (const track of state.subtitles) {
        tracks[track.index].mode = track.index === next ? 'showing' : 'disabled';
      }
    }
    this._emitTrackChange();
    return this.getTrackState();
  }

  
  
  
  getLiveLatency() {
    if (this.mode !== 'live') return null;
    if (this.hls) {
      const l = this.hls.latency;
      if (typeof l === 'number' && isFinite(l) && l >= 0) return l;
    }
    const v = this.video;
    const sk = v && v.seekable;
    if (sk && sk.length) {
      const d = sk.end(sk.length - 1) - v.currentTime;
      if (isFinite(d) && d >= 0) return d;
    }
    return null;
  }

  
  
  getLoadedBytes() {
    if (this.hls) return this._loadedBytes || 0;
    const v = this.video;
    return (v.webkitVideoDecodedByteCount || 0) + (v.webkitAudioDecodedByteCount || 0);
  }

  _errorStatus(data) {
    const res = data && data.response;
    if (res && Number.isFinite(res.code)) return res.code;
    const details = data && data.networkDetails;
    if (details && Number.isFinite(details.status)) return details.status;
    return 0;
  }

  _isPermanentNetworkError(data) {
    const code = this._errorStatus(data);
    return code >= 400 && code < 500;
  }

  _scheduleNetRetry(hls) {
    const delays = CFG.networkRetry.delays;
    const delay = delays[Math.min(Math.max(this._netRetries - 1, 0), delays.length - 1)];
    clearTimeout(this._netRetryTimer);
    this._netRetryTimer = setTimeout(() => {
      this._netRetryTimer = null;
      if (this.hls !== hls || !this.current) return;
      try { hls.startLoad(); } catch (e) {}
    }, delay);
  }

  _destroyHls() {
    this._clearStartup();
    clearTimeout(this._netRetryTimer);
    this._netRetryTimer = null;
    this._startup = null;
    const hls = this.hls;
    this.hls = null;
    if (hls) {
      try { hls.destroy(); } catch (e) {}
    }
    
    if (this.engine) {
      this.engine.destroy();
      this.engine = null;
    }
    this._appliedRate = 1;
  }

  _canNativeHls() {
    return !!this.video.canPlayType('application/vnd.apple.mpegurl');
  }

  
  _tryPlay() {
    const phase = this._phase;
    const path = this._activePath;
    const p = this.video.play();
    if (p && typeof p.catch === 'function') {
      p.catch((error) => {
        
        if (this._phase !== phase || this._activePath !== path || !this.current ||
            !error || error.name !== 'NotAllowedError') return;
        this.video.muted = true;
        this._autoMuted = true;
        this.video.play().catch(() => {});
      });
    }
  }

  
  
  
  userUnmute() {
    this._userInteracted = true;
    this._unmuteIfAllowed();
  }

  
  _unmuteIfAllowed() {
    if (!this._autoMuted || !this._userInteracted) return;
    this.video.muted = false;
    this._autoMuted = false;
  }

  
  _load(rawUrl, decoder = 'auto') {
    this._warmTuning = getTuning();
    this._clearStartup();
    clearTimeout(this._nativeReloadTimer);
    this._nativeReloadTimer = null;
    this._nativeRetries = 0;
    this._nativeErrAt = 0;
    this._playedOnce = false;
    this._startup = null;
    this._phase = { t0: Date.now() }; 
    this._decoder = decoder; 
    this._aligned = false; 
    this._alignNote = ''; 
    this._alignWin = null; 
    resetSegHits(); 
    this._warmHeld = segCount(); 
    this._resetMediaInfo(); 

    const url = proxied(rawUrl);
    this._rawUrl = rawUrl;
    this._proxiedUrl = url;
    this._startupTimeoutMs = isRemuxUrl(rawUrl) ? REMUX_STARTUP_TIMEOUT_MS : CFG.startup.timeoutMs;
    
    rememberHeaders(rawUrl, this.current && this.current.channel && this.current.channel.headers);
    this._triedNativeFallback = false;
    this._netRetries = 0;
    this._mediaRetries = 0;
    clearTimeout(this._netRetryTimer);
    this._netRetryTimer = null;
    this._loadedBytes = 0;
    const isHls = isHlsUrl(rawUrl);
    
    
    const nativeBlocked = !this._nativeAllowed(rawUrl);
    
    
    const preferNative =
      !nativeBlocked && decoder === 'auto' && this._canNativeHls() && this._looksHevc(rawUrl);
    const useHlsJs = isHls && Hls.isSupported() &&
      (decoder !== 'native' || nativeBlocked) && !preferNative;
    
    
    
    
    
    this._abortWarm(useHlsJs && this._warmEnabled() ? rawUrl : null);

    if (useHlsJs) {
      this._activePath = 'hls';
      
      
      if (this._tuningDirty) {
        this._destroyHls();
        this._tuningDirty = false;
      }
      
      
      if (this.engine || this._wantEngine()) this._destroyHls();
      
      
      if (this.hls) {
        try {
          this.hls.stopLoad();
          this.hls.loadSource(url);
          
          
          return;
        } catch (e) {
          this._destroyHls(); 
        }
      }
      
      this.video.removeAttribute('src');
      this._createHls(url);
    } else {
      this._warmNote('v');
      
      
      if (headersFor(rawUrl)) {
        try { console.log('[hdr] native path ignores headers: ' + redactUrl(rawUrl)); } catch (e) {}
      }
      this._startNative(url);
    }
  }

  _startNative(url, fallback = null) {
    const now = Date.now();
    const t0 = this._phase ? this._phase.t0 : now;
    this._destroyHls();
    this._playedOnce = false; 
    
    if (this.mode === 'catchup' && this.rate !== 1) this._dropRate('native');
    this._activePath = 'native';
    this._phase = { t0, native: now, fallback };
    this.video.removeAttribute('src');
    this.video.preload = 'auto';
    this.video.src = url;
    this.video.load();
    this._watchStartup();
    if (fallback && this.onStateChange) this.onStateChange('nativefallback');
    this._tryPlay();
  }

  
  
  
  static _fragLoaderFor(Base) {
    if (!Player._fragLoaders) Player._fragLoaders = new Map();
    let C = Player._fragLoaders.get(Base);
    if (!C) {
      C = makeCachedFragLoader(Base);
      Player._fragLoaders.set(Base, C);
    }
    return C;
  }

  
  _createHls(url) {
    
    const tune = getTuning();
    const cfg = { ...CFG.hls, ...toHlsConfig(tune) };
    
    // Remux manifests are instant, but the first segment can take ~30s while
    // the server spins up ffmpeg. Give those URLs a wider floor than the
    // user's tuning values.
    if (isRemuxUrl(this._rawUrl || url)) {
      cfg.manifestLoadingTimeOut = Math.max(cfg.manifestLoadingTimeOut || 0, REMUX_MANIFEST_TIMEOUT_MS);
      cfg.fragLoadingTimeOut = Math.max(cfg.fragLoadingTimeOut || 0, REMUX_FRAG_TIMEOUT_MS);
      cfg.fragLoadingMaxRetry = Math.max(cfg.fragLoadingMaxRetry || 0, REMUX_FRAG_MAX_RETRY);
      cfg.fragLoadingRetryDelay = Math.max(cfg.fragLoadingRetryDelay || 0, REMUX_FRAG_RETRY_DELAY_MS);
    }
    
    cfg.autoStartLoad = false;
    
    
    cfg.xhrSetup = (xhr, u) => applyHeaders(xhr, u);
    const hls = new Hls(cfg);
    this.hls = hls;
    
    
    
    //
    
    
    
    
    
    setRangeLanes(tune.fragParallel);
    if (tune.prefetchSegmentBytes > 0 || rangeLanes() >= 2) {
      hls.config.fLoader = Player._fragLoaderFor(hls.config.loader);
    }
    
    
    
    
    hls.config.pLoader = makeVodPlaylistLoader(hls.config.loader, () => this._vodExpect());
    
    try {
      const base = hls.config.loader;
      console.log(
        '[warm] frag base=' + ((base && base.name) || '?') +
          ' cached=' + !!hls.config.fLoader +
          ' lanes=' + rangeLanes()
      );
    } catch (e) {}
    const fail = (message) => {
      if (this.hls !== hls) return;
      this._abortWarm(null);
      this._destroyHls();
      if (this.onError) this.onError(message);
    };
    
    let eng = null;
    if (this._wantEngine()) {
      eng = new SpeedEngine(this.video, this.rate, this._speedCap.path);
      eng.onFail = (reason) => {
        if (this.engine === eng) this._engineFail(reason);
      };
      eng.attach(hls);
      this.engine = eng;
      this._appliedRate = this.rate;
      
      hls.on(Hls.Events.LEVEL_LOADED, (evt, data) => {
        if (data && data.details && data.details.live) eng.fail('live');
      });
      hls.on(Hls.Events.BUFFER_CREATED, (evt, data) => {
        const tracks = (data && data.tracks) || {};
        if (!tracks.video && !tracks.audiovideo) eng.fail('no-video');
      });
    }
    hls.on(Hls.Events.ERROR, (evt, data) => {
      if (!data || this.hls !== hls) return;
      this._dbg(data.fatal ? 'error' : 'warn',
        String(data.type || '') + '/' + String(data.details || '') + ' http=' + this._errorStatus(data));
      
      if (eng && this.engine === eng &&
          ((data.fatal && data.type === Hls.ErrorTypes.MEDIA_ERROR) || /codec/i.test(data.details || ''))) {
        eng.fail('media');
        return;
      }
      
      
      
      if (!data.fatal && /codec/i.test(data.details || '')) {
        if (this._canNativeHls() && this._fallbackToNative('codec')) return;
      }
      if (data.fatal) {
        
        if (data.details && /codec/i.test(data.details)) {
          
          if (this._canNativeHls() && this._fallbackToNative('codec')) return;
          fail(t('perr.hevcUnsupported'));
          return;
        }
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            if (this._isPermanentNetworkError(data)) {
              fail(t('perr.networkLost'));
            } else if (++this._netRetries > CFG.maxErrorRetries) {
              fail(t('perr.networkLost'));
            } else {
              this._scheduleNetRetry(hls);
            }
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            if (++this._mediaRetries > CFG.maxErrorRetries) {
              fail(t('perr.decodeFailed'));
            } else {
              hls.recoverMediaError();
            }
            break;
          default:
            fail(t('perr.playFailed', { detail: data.details || t('perr.unknown') }));
        }
      }
    });
    
    const countBytes = (evt, data) => {
      if (this.hls !== hls) return;
      if (data && data.frag && data.frag.type === 'main' && Number.isFinite(data.frag.sn)) {
        this._mark('frag');
        this._dbg('frag', '#' + data.frag.sn + ' ok');
      }
      const st = data && (data.stats || (data.frag && data.frag.stats));
      const n = (st && (st.loaded || st.total)) ||
        (data && data.payload && data.payload.byteLength) || 0;
      if (n > 0) this._loadedBytes += n;
      if (this.hls === hls) this._recordFragLoad(data);
    };
    hls.on(Hls.Events.FRAG_LOADED, countBytes);
    
    hls.on(Hls.Events.FRAG_BUFFERED, (evt, data) => {
      if (this.hls !== hls) return;
      if (data && data.frag && data.frag.type === 'main' && Number.isFinite(data.frag.sn)) {
        this._mark('buffered');
        this._watchStartup();
      }
      this._pumpWarm();
    });
    
    hls.on(Hls.Events.BUFFER_CODECS, (evt, data) => {
      if (!data || this.hls !== hls) return;
      if (data.video && data.video.codec) this.mediaInfo.videoCodec = data.video.codec;
      if (data.audio && data.audio.codec) this.mediaInfo.audioCodec = data.audio.codec;
      this._dbg('codecs', String((data.video && data.video.codec) || '?') + '/' + String((data.audio && data.audio.codec) || '?'));
      this._emitMediaInfo();
    });

    hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
      if (this.hls !== hls) return;
      this._dbg('audioTracks', String((hls.audioTracks || []).length));
      this.applySavedTracks();
    });
    hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => {
      if (this.hls !== hls) return;
      this._dbg('subtitles', String((hls.subtitleTracks || []).length));
      this.applySavedTracks();
    });
    
    hls.on(Hls.Events.LEVEL_SWITCHED, (evt, data) => {
      if (this.hls !== hls) return;
      const lv = hls.levels && hls.levels[data && data.level];
      if (!lv) return;
      if (!this.mediaInfo.width && lv.width && lv.height) {
        this.mediaInfo.width = lv.width;
        this.mediaInfo.height = lv.height;
      }
      if (!this.mediaInfo.videoCodec && lv.videoCodec) this.mediaInfo.videoCodec = lv.videoCodec;
      if (!this.mediaInfo.audioCodec && lv.audioCodec) this.mediaInfo.audioCodec = lv.audioCodec;
      this._emitMediaInfo();
    });
    
    hls.attachMedia(this.video);
    hls.loadSource(url);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      if (this.hls !== hls) return;
      this._mark('manifest');
      this._dbg('manifest', 'levels=' + ((hls.levels || []).length));
      this.applySavedTracks();
      
      
      
      
      if (this._hevcNeedsNative(hls)) {
        this.mediaInfo.videoCodec = 'hevc'; 
        this._emitMediaInfo();
        if (this._fallbackToNative('hevc')) return;
      }
      
      
      if (this._audioNeedsNative(hls) && this._fallbackToNative('audio')) return;
      
      if (this.mode === 'catchup' && this._resumeAt > 0) {
        this._aligned = true;
        
        
        hls.config.startOnSegmentBoundary = false;
        this._tuningDirty = true;
        hls.startLoad(this._resumeAt);
        this._tryPlay();
        return;
      }
      
      const pos = this._alignedStart(hls);
      if (pos >= 0) this._aligned = true; 
      hls.startLoad(pos);
      this._tryPlay();
    });
    
    //
    
    
    
    
    
    
    //
    
    
    
    
    hls.on(Hls.Events.LEVEL_LOADED, (evt, data) => {
      if (this.hls !== hls || this._aligned) return;
      const det = data && data.details;
      if (!det || !det.fragments || !det.fragments.length) return;
      this._aligned = true; 
      const pos = this._alignedStart(hls, det);
      if (pos >= 0) hls.startLoad(pos);
    });
  }

  
  //
  
  
  //
  
  
  
  //
  
  //
  
  
  _alignedStart(hls, det) {
    try {
      if (!(getTuning().prefetchSegmentBytes > 0)) {
        this._alignNote = 'off';
        return -1;
      }
      if (!det) {
        const levels = hls.levels || [];
        let li = hls.startLevel;
        if (li < 0) li = hls.firstLevel;
        const lv = levels[li >= 0 ? li : 0];
        det = lv && lv.details;
      }
      const frags = det && det.fragments;
      if (!frags || !frags.length || !det.live) {
        this._alignNote = 'nodet';
        return -1;
      }
      
      const dflt = det.edge - (getTuning().liveSyncDuration || 0);
      let pick = -1;
      for (let i = 0; i < frags.length; i++) {
        
        
        if (!hasSeg(frags[i].url) && !pendingSeg(frags[i].url)) continue;
        if (frags[i].start <= dflt) {
          pick = i; 
        } else {
          
          
          if (pick < 0) pick = i;
          break;
        }
      }
      if (pick < 0) {
        
        
        
        
        
        
        
        
        this._alignNote = 'nowin';
        this._alignWin = {
          lo: urlSegNum(frags[0].url),
          hi: urlSegNum(frags[frags.length - 1].url),
          n: frags.length,
          have: cachedSegNums(frags[0].url)
        };
        return -1;
      }
      const f = frags[pick];
      
      
      const dur = f.duration || det.targetduration || 0;
      if (dur > 0 && dflt - f.start > ALIGN_LAG_SEG * dur) {
        this._alignNote = 'old';
        return -1;
      }
      this._alignNote = 'ok';
      try {
        console.log(
          '[warm] align start ' + f.start.toFixed(2) + 's (default ' + dflt.toFixed(2) + 's) ' + redactUrl(f.url)
        );
      } catch (e) {}
      return f.start;
    } catch (e) {
      this._alignNote = 'err';
      return -1;
    }
  }

  
  
  _nativeAllowed(url = this._rawUrl || this._proxiedUrl) {
    if (this._nativeOff) return false;
    return !(url && this._nativeBad && this._nativeBad.has(url));
  }

  
  
  _nativeMarkBad(url = this._rawUrl || this._proxiedUrl) {
    if (!url) return;
    if (!this._nativeBad) this._nativeBad = new Set();
    boundedAdd(this._nativeBad, url, CFG.nativeCacheMax);
    if (this._nativeUrls) this._nativeUrls.delete(url);
  }

  
  
  _nativeCountFail() {
    if (this._nativeOff) return;
    this._nativeFails++;
    console.log('[native] decode failed ' + this._nativeFails + '/' + CFG.nativeBreaker);
    if (this._nativeFails < CFG.nativeBreaker) return;
    this._nativeOff = true;
    console.log('[native] disabled for this session');
    if (this._nativeUrls) this._nativeUrls.clear();
    if (this.onNotice) this.onNotice(t('toast.nativeOff'));
  }

  
  
  _isHeavyStream() {
    const info = this.mediaInfo || {};
    if (/hvc1|hev1|h\.?265|hevc/i.test(String(info.videoCodec || ''))) return true;
    if ((info.height || 0) >= 2000 || (this.video.videoHeight || 0) >= 2000) return true;
    const name = (this.current && this.current.channel && this.current.channel.name) || '';
    return /4k|8k|2160|uhd|hevc|h\.?265/i.test(name + ' ' + (this._rawUrl || ''));
  }

  
  
  
  
  
  
  _retryNativeMediaError(err) {
    if (this.mode !== 'live' || !this._playedOnce) return false;
    const code = err && err.code;
    if (code !== 2 && code !== 3) return false; 
    
    
    if (code === 3 && this._isHeavyStream()) return false;
    const url = this._proxiedUrl || this._rawUrl;
    if (!url) return false;
    const now = Date.now();
    if (now - this._nativeErrAt > CFG.nativeRetry.windowMs) this._nativeRetries = 0;
    this._nativeErrAt = now;
    if (this._nativeRetries >= CFG.nativeRetry.max) return false;
    const n = ++this._nativeRetries;
    console.log('[native] error ' + code + ' after playback, reload ' + n + '/' + CFG.nativeRetry.max);
    if (this.onStateChange) this.onStateChange('nativereconnect');
    clearTimeout(this._nativeReloadTimer);
    this._nativeReloadTimer = setTimeout(() => {
      this._nativeReloadTimer = null;
      if (!this.current || this._activePath !== 'native') return;
      this._startup = null; 
      this._startNative(url, 'reconnect');
    }, CFG.nativeRetry.delayMs * n);
    return true;
  }

  _nativeStartupFailed() {
    if (this.mode !== 'live' || this._activePath !== 'native' || this._decoder !== 'auto' ||
        this._playedOnce || this._triedNativeFallback || !isHlsUrl(this._rawUrl || '') ||
        !Hls.isSupported()) return false;
    
    this._triedNativeFallback = true;
    if (this._nativeUrls) this._nativeUrls.delete(this._rawUrl);
    this._abortWarm(null);
    this._destroyHls();
    this._phase = { t0: Date.now() };
    this._playedOnce = false;
    this._activePath = 'hls';
    this._resetMediaInfo();
    this.video.removeAttribute('src');
    this.video.load();
    if (this.onStateChange) this.onStateChange('hlsfallback');
    this._createHls(this._proxiedUrl || this._rawUrl);
    return true;
  }

  
  
  _fallbackToNative(reason = 'media') {
    if (this._triedNativeFallback || !this._proxiedUrl) return false;
    if (!this._nativeAllowed()) return false; 
    this._abortWarm(null);
    this._triedNativeFallback = true;
    if (this._rawUrl) {
      if (!this._nativeUrls) this._nativeUrls = new Set();
      boundedAdd(this._nativeUrls, this._rawUrl, CFG.nativeCacheMax);
    }
    this._startNative(this._proxiedUrl, reason);
    return true;
  }

  
  //
  
  
  
  _willUseNative(rawUrl) {
    if (!this._nativeAllowed(rawUrl)) return false;
    if (this._decoder === 'native') return true;
    return !!(this._nativeUrls && this._nativeUrls.has(rawUrl));
  }

  
  
  
  
  
  _looksHevc(rawUrl) {
    if (!this._nativeAllowed(rawUrl)) return false; 
    if (this._nativeUrls && this._nativeUrls.has(rawUrl)) return true;
    if (this._mseHevcOk()) return false; 
    const name = (this.current && this.current.channel && this.current.channel.name) || '';
    return /4k|8k|2160|uhd|hevc|h\.?265/i.test(name + ' ' + rawUrl);
  }

  
  
  _mseHevcOk() {
    try {
      const mse = window.MediaSource;
      if (!mse || !mse.isTypeSupported) return false;
      return ['hvc1.1.6.L150.90', 'hev1.1.6.L150.90'].some((c) =>
        mse.isTypeSupported('video/mp4; codecs="' + c + '"')
      );
    } catch (e) {
      return false;
    }
  }

  
  _hevcNeedsNative(hls) {
    try {
      const levels = (hls && hls.levels) || [];
      const isHevc = (c) => /hvc1|hev1|h\.?265|hevc/i.test(c || '');
      const anyHevc = levels.some((l) => isHevc(l.videoCodec) || isHevc(l.codecs));
      if (!anyHevc) return false;
      
      return !this._mseHevcOk() && this._canNativeHls();
    } catch (e) {
      return false;
    }
  }

  
  
  
  _audioNeedsNative(hls) {
    try {
      if (!this._canNativeHls()) return false; 
      const mse = window.MediaSource;
      if (!mse || !mse.isTypeSupported) return false;
      const codecs = new Set();
      for (const l of (hls && hls.levels) || []) if (l.audioCodec) codecs.add(l.audioCodec);
      for (const a of (hls && hls.audioTracks) || []) if (a.audioCodec) codecs.add(a.audioCodec);
      if (!codecs.size) return false;
      for (const c of codecs) {
        if (mse.isTypeSupported('audio/mp4; codecs="' + c + '"')) return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  
  _warmEnabled() {
    return this._warmTuning.prefetchSegmentBytes > 0 && getTuning().prefetchSegmentBytes > 0;
  }

  
  
  
  prefetch(rawUrl, refresh = false, headers = null) {
    rememberHeaders(rawUrl, headers);
    if (!this._warmEnabled()) {
      this._abortWarm(null);
      return Promise.resolve();
    }
    const generation = this._warmGeneration;
    if (!this.current || this.mode !== 'live' || rawUrl === this.current.url) return Promise.resolve();
    if (!rawUrl || !isHlsUrl(rawUrl)) {
      
      this._warmNote('n');
      try { console.log('[warm] skip (not m3u8) ' + redactUrl(rawUrl)); } catch (e) {}
      return Promise.resolve();
    }
    if (!this._prefetched) this._prefetched = new Map();
    if (this._willUseNative(rawUrl)) {
      if (!refresh && Date.now() - (this._prefetched.get(rawUrl) || 0) < WARM_REDO_MS) return Promise.resolve();
      boundedSet(this._prefetched, rawUrl, Date.now(), CFG.prefetchCacheMax);
      this._warmNote('v', rawUrl);
      return this._fetchWarmManifest(rawUrl, rawUrl, generation, 0, true);
    }
    let target = this._warmTargets.get(rawUrl);
    if (!target) {
      target = { nextAt: 0, interval: WARM_REDO_MS };
      boundedSet(this._warmTargets, rawUrl, target, CFG.prefetchCacheMax);
    }
    if (refresh) target.nextAt = 0;
    return this._refreshWarmTargets();
  }

  _refreshWarmTargets() {
    if (this._warmRefresh) return this._warmRefresh.promise;
    if (!this._updateWarmGate() || this._warming) return Promise.resolve();
    if (![...this._warmTargets.values()].some((target) => target.nextAt <= Date.now())) return Promise.resolve();
    const generation = this._warmGeneration;
    const entry = { promise: null };
    this._warmRefresh = entry;
    entry.promise = Promise.resolve().then(async () => {
      for (const [chan, target] of this._warmTargets) {
        if (generation !== this._warmGeneration || !this._updateWarmGate()) return;
        if (target.nextAt > Date.now()) continue;
        target.nextAt = Date.now() + target.interval;
        this._warmQ = (this._warmQ || []).filter((job) => job.chan !== chan);
        boundedSet(this._prefetched, chan, Date.now(), CFG.prefetchCacheMax);
        await this._fetchWarmManifest(chan, chan, generation);
        if (generation !== this._warmGeneration) return;
        target.nextAt = target.once ? Infinity : Date.now() + target.interval;
      }
    }).finally(() => {
      if (this._warmRefresh !== entry) return;
      this._warmRefresh = null;
      this._pumpWarm();
    });
    return entry.promise;
  }

  _fetchWarmManifest(url, chan, generation, depth = 0, manifestOnly = false) {
    if (!this._warmEnabled() || generation !== this._warmGeneration) return Promise.resolve();
    if (!this._warmManifests) this._warmManifests = new Map();
    const active = this._warmManifests.get(url);
    if (active) return active.promise;
    const ctl = new AbortController();
    const entry = { promise: null, chan, ctl };
    this._warmManifests.set(url, entry);
    if (!this._warmManifestOwners) this._warmManifestOwners = new Map();
    boundedSet(this._warmManifestOwners, url, chan, CFG.prefetchCacheMax);
    const timer = setTimeout(() => ctl.abort(), WARM_MANIFEST_TIMEOUT);
    entry.promise = Promise.resolve()
      .then(async () => {
        if (!this._warmEnabled() || generation !== this._warmGeneration) return;
        const response = await fetch(proxied(url), {
          cache: 'no-store',
          signal: ctl.signal,
          headers: withHeaders(url)
        });
        if (!this._warmEnabled() || ctl.signal.aborted || !response || response.ok === false) {
          cancelWarmBody(response && response.body);
          throw new Error('manifest unavailable');
        }
        const text = await response.text();
        checkWarmAbort(ctl, this._warmEnabled());
        clearTimeout(timer);
        if (manifestOnly || generation !== this._warmGeneration) return;
        let base = response.url || url;
        const resolved = new URL(base, url);
        if (resolved.pathname === '/__proxy__') base = resolved.searchParams.get('u') || url;
        return this._warmStartSegment(base, text, chan, generation, depth);
      })
      .catch(() => {
        if (generation === this._warmGeneration) this._warmNote('m', chan);
      })
      .finally(() => {
        clearTimeout(timer);
        ctl.abort();
        if (this._warmManifests.get(url) === entry) this._warmManifests.delete(url);
      });
    return entry.promise;
  }

  
  holdWarm() {
    this._warmHold = true;
  }

  
  
  _bufferAhead() {
    try {
      const pos = this.video.currentTime;
      const ranges = this.video.buffered;
      if (!Number.isFinite(pos) || !ranges) return 0;
      for (let i = 0; i < ranges.length; i++) {
        if (ranges.start(i) <= pos && pos < ranges.end(i)) return ranges.end(i) - pos;
      }
    } catch (e) {}
    return 0;
  }

  _recordFragLoad(data) {
    const frag = data && data.frag;
    
    if (!frag || frag.type !== 'main' || !Number.isFinite(frag.sn)) return;
    if (Number.isFinite(frag.duration) && frag.duration > 0) this._fragDuration = frag.duration;
    const stats = data.stats || frag.stats;
    const load = stats && stats.loading;
    if (load && Number.isFinite(load.start) && Number.isFinite(load.end) && load.end > load.start) {
      
      const sec = (load.end - load.start) / 1000;
      this._fragLoadSec = Math.max(sec, this._fragLoadSec * CFG.warmSafety.downloadDecay);
    }
  }

  _warmThresholds() {
    const tune = this._warmTuning;
    let resume = tune.prefetchStartBuffer;
    let hold = tune.prefetchHoldBuffer;
    if (tune.prefetchAdaptive) {
      const cfg = CFG.warmSafety;
      const target = (this.hls && this.hls.config.maxBufferLength) || CFG.hls.maxBufferLength;
      const segment = Math.min(this._fragDuration * cfg.segmentFactor, target * cfg.targetFraction);
      resume = Math.max(resume, segment, this._fragLoadSec * cfg.downloadFactor + cfg.downloadSlack);
      hold = Math.max(hold, resume / 2);
    }
    return { resume, hold };
  }

  applyWarmTuning(tuning) {
    this._warmTuning = tuning;
    this.holdWarm();
    this._pumpWarm();
  }

  getWarmBufferStatus() {
    if (!this.current) return null;
    return {
      ...this._warmThresholds(),
      ahead: this._bufferAhead() / Math.max(1, this.video.playbackRate || 1)
    };
  }

  _updateWarmGate() {
    if (!this._warmEnabled()) {
      this._abortWarm(null);
      return false;
    }
    const v = this.video;
    const limits = this._warmThresholds();
    const ahead = this._bufferAhead() / Math.max(1, v.playbackRate || 1);
    const playable = this.current && this.mode === 'live' && this._warmPlaying &&
      !v.paused && !v.ended && !v.seeking && !v.error && v.readyState >= 3;
    const hold = !playable || (this._warmHold ? ahead < limits.resume : ahead < limits.hold);
    if (hold !== this._warmHold) {
      this._warmHold = hold;
      this._logBuffer(hold ? 'warm-hold' : 'warm-resume');
    }
    return !hold;
  }

  
  _logBuffer(event) {
    if (!this.current) return;
    const limits = this._warmThresholds();
    const channel = this.current.channel || {};
    try {
      console.log('[buffer] ' + JSON.stringify({
        event,
        channel: channel.name || '',
        generation: this._warmGeneration,
        path: this.activePath(),
        position: Number((this.video.currentTime || 0).toFixed(2)),
        ahead: Number(this._bufferAhead().toFixed(2)),
        resume: Number(limits.resume.toFixed(2)),
        hold: Number(limits.hold.toFixed(2)),
        fragLoad: Number(this._fragLoadSec.toFixed(2)),
        warm: this._warming ? (this._warmChan === this.current.url ? 'current' : 'neighbour') : 'none',
        queued: this._warmQ ? this._warmQ.length : 0
      }));
    } catch (e) {}
  }

  
  //
  
  
  
  
  
  
  _warmStartSegment(manifestUrl, text, chan, generation, depth = 0) {
    if (!this._warmEnabled() || generation !== this._warmGeneration || !this.current || this.mode !== 'live') return;
    if (!text) {
      this._warmNote('m', chan); 
      return;
    }
    try {
      const segs = [];
      let dur = 0;
      let vod = false;
      for (const line of text.split(/\r?\n/)) {
        const s = line.trim();
        if (!s) continue;
        if (s[0] === '#') {
          if (s.indexOf('#EXTINF:') === 0) dur = parseFloat(s.slice(8)) || 0;
          else if (s.indexOf('#EXT-X-ENDLIST') === 0) vod = true; 
          continue;
        }
        segs.push({ uri: s, dur });
        dur = 0;
      }
      if (!segs.length) {
        this._warmNote('q', chan); 
        return;
      }
      const first = resolveMediaUrl(segs[0].uri, manifestUrl);
      
      
      
      if (isHlsUrl(first)) {
        if (depth >= 1 || first === manifestUrl) return;
        boundedSet(this._prefetched, first, Date.now(), CFG.prefetchCacheMax);
        return this._fetchWarmManifest(first, chan, generation, depth + 1);
      }
      const target = this._warmTargets.get(chan);
      if (target) {
        const duration = Math.max(...segs.map((seg) => seg.dur));
        target.interval = Math.max(WARM_REDO_MS, Math.min(WARM_JOB_TTL, duration * 1000));
        target.once = vod;
      }
      const idx = vod ? 0 : this._startSegIndex(segs);
      
      //
      
      
      
      
      
      const from = Math.min(idx + (vod ? 0 : WARM_LEAD), segs.length - 1);
      const urls = [];
      for (let i = from; i < segs.length && urls.length < WARM_SEG_MAX; i++) {
        urls.push(proxied(resolveMediaUrl(segs[i].uri, manifestUrl)));
      }
      try {
        console.log(
          '[warm] pick ' + (from + 1) + '/' + segs.length + ' of ' + redactUrl(manifestUrl) +
            ' -> ' + JSON.stringify(urls.map(redactUrl))
        );
      } catch (e) {}
      this._queueWarm(urls, chan);
    } catch (e) {}
  }

  
  
  //
  
  
  
  _startSegIndex(segs) {
    const n = segs.length;
    if (n < 2) return 0;
    const starts = [];
    let acc = 0;
    for (let i = 0; i < n; i++) {
      starts.push(acc);
      acc += segs[i].dur;
    }
    const edge = acc; // = starts[n-1] + segs[n-1].dur
    const goal = edge - (getTuning().liveSyncDuration || 0);
    for (let i = n - 1; i >= 0; i--) if (starts[i] <= goal) return i;
    return 0; 
  }

  
  
  
  
  //
  
  
  
  
  _queueWarm(urls, chan) {
    if (!this._warmEnabled()) {
      this._abortWarm(null);
      return;
    }
    if (!urls || !urls.length) return;
    const cap = getTuning().prefetchSegmentBytes;
    
    
    
    
    setSegBudget(
      Math.max(cap, Math.min(cap * (WARM_SEG_MAX * 2 + 1), WARM_TOTAL_MAX))
    );
    if (!this._warmQ) this._warmQ = [];
    
    
    
    
    const at = Date.now();
    const queued = this._warmQ.length;
    urls.forEach((url, slot) => {
      if (hasSeg(url) || pendingSeg(url) || this._warmQ.some((job) => job.url === url)) return;
      this._warmQ.push({ url, cap, at, slot, chan });
    });
    
    
    
    if (this._warmQ.length > queued) this._warmNote('0', chan);
    this._pumpWarm();
  }

  
  
  
  _warmNote(code, chan) {
    this._note = code;
    if (!chan) return;
    
    
    if (!this._warmNotes) this._warmNotes = new Map();
    boundedSet(this._warmNotes, chan, code, CFG.prefetchCacheMax);
  }

  _noteOf(chan) {
    return (chan && this._warmNotes && this._warmNotes.get(chan)) || '';
  }

  
  //
  
  
  
  
  _abortWarm(keepChan) {
    this._warmGeneration++;
    this._warmTargets.clear();
    this._warmRefresh = null;
    this._warmPlaying = false;
    this.holdWarm();
    this._fragDuration = 0;
    this._fragLoadSec = 0;
    this._bufferEvent = '';
    
    const enabled = this._warmEnabled();
    const keepWarm = enabled && keepChan && this._warmChan === keepChan;
    if (!enabled) {
      setSegBudget(0);
      this._warmHeld = 0;
      this._prefetched.clear();
      if (this._warmManifestOwners) this._warmManifestOwners.clear();
    }
    const cancelled = new Set();
    if (this._warmManifests) {
      for (const entry of this._warmManifests.values()) {
        cancelled.add(entry.chan);
        entry.ctl.abort();
      }
      this._warmManifests.clear();
    }
    if (this._warmQ) {
      for (const job of this._warmQ) cancelled.add(job.chan);
      this._warmQ.length = 0;
    }
    if (this._warmCtl && !keepWarm) cancelled.add(this._warmChan);
    if (this._prefetched) {
      for (const chan of cancelled) this._prefetched.delete(chan);
      
      if (this._warmManifestOwners) {
        for (const [url, chan] of this._warmManifestOwners) {
          if (!cancelled.has(chan)) continue;
          this._prefetched.delete(url);
          this._warmManifestOwners.delete(url);
        }
      }
    }
    if (this._warmCtl && !keepWarm) {
      try { this._warmCtl.abort(); } catch (e) {}
      this._warmCtl = null;
      this._warming = false;
    }
  }

  
  
  
  _takeWarmJob() {
    const q = this._warmQ;
    if (!q || !q.length) return null;
    let pick = 0;
    for (let i = 1; i < q.length; i++) if (q[i].slot < q[pick].slot) pick = i;
    return q.splice(pick, 1)[0];
  }

  _pumpWarm() {
    
    if (!this._updateWarmGate() || this._warming || this._warmRefresh) return;
    const now = Date.now();
    this._warmQ = (this._warmQ || []).filter((job) => {
      if (now - job.at <= WARM_JOB_TTL) return true;
      const target = this._warmTargets.get(job.chan);
      if (target) target.nextAt = 0;
      else this._warmTargets.set(job.chan, { nextAt: 0, interval: WARM_REDO_MS });
      return false;
    });
    this._refreshWarmTargets();
    if (this._warmRefresh) return;
    const job = this._takeWarmJob();
    if (!job) return;
    const cap = job.cap;
    this._warming = true;
    this._warmChan = job.chan; 
    let ctl = null;
    try { ctl = new AbortController(); } catch (e) {}
    this._warmCtl = ctl;
    
    
    
    
    
    if (this._noteOf(job.chan) === '0') this._warmNote('r', job.chan);
    
    const watchdog = setTimeout(() => {
      try { console.log('[warm] timeout ' + redactUrl(job.url)); } catch (e) {}
      try { if (ctl) ctl.abort(); } catch (e) {}
    }, WARM_LOAD_TIMEOUT);
    
    
    const done = () => {
      clearTimeout(watchdog);
      if (this._warmCtl !== ctl) return;
      this._warming = false;
      this._warmCtl = null;
      this._pumpWarm();
    };
    const t0 = Date.now();
    try {
      
      
      
      const chain = this._warmOne(job, ctl, cap)
        .then((buf) => {
          
          checkWarmAbort(ctl, this._warmEnabled());
          if (this._warmCtl !== ctl) { done(); return; }
          if (buf && buf.byteLength && buf.byteLength <= cap) {
            const ms = Date.now() - t0;
            putSeg(job.url, buf, ms);
            
            
            if (job.slot === 0) noteWarmMs(ms);
            this._warmNote('k', job.chan); 
            try { console.log('[warm] stored ' + buf.byteLength + 'B ' + redactUrl(job.url)); } catch (e) {}
          } else {
            
            
            if (this._noteOf(job.chan) !== 'e') this._warmNote('b', job.chan); 
            try { console.log('[warm] skip (over cap) ' + redactUrl(job.url)); } catch (e) {}
          }
          done();
        })
        .catch(() => {
          
          
          
          
          if (this._noteOf(job.chan) !== 'g') {
            this._warmNote(ctl && ctl.signal && ctl.signal.aborted ? 'a' : 'e', job.chan);
          }
          done();
        });
      
      
      setPending(job.url, chain, {
        startedAt: t0,
        abort: () => {
          
          this._warmNote('g', job.chan);
          try { if (ctl) ctl.abort(); } catch (e) {}
        }
      });
    } catch (e) {
      this._warmNote('e', job.chan);
      done();
    }
  }

  
  //
  
  
  
  
  //
  
  
  async _warmOne(job, ctl, cap) {
    checkWarmAbort(ctl, this._warmEnabled());
    
    
    
    const lanes = job.slot === 0 ? rangeLanes() : warmLanes();
    const rj = rangeLoad(job.url, WARM_LOAD_TIMEOUT, {
      lanes,
      maxBytes: cap,
      signal: ctl && ctl.signal, 
      tag: job.slot === 0 ? 'warm-range-1st' : 'warm-range' 
    });
    if (!rj) return this._warmWhole(job, ctl, cap);
    const res = await rj.promise;
    checkWarmAbort(ctl, this._warmEnabled());
    if (res && res.buf) return res.buf;
    if (res && res.overCap) {
      try { console.log('[warm] skip size >= ' + res.total + 'B > cap ' + cap + 'B ' + redactUrl(job.url)); } catch (e) {}
      return null;
    }
    return this._warmWhole(job, ctl, cap);
  }

  async _warmWhole(job, ctl, cap) {
    checkWarmAbort(ctl, this._warmEnabled());
    const res = await fetch(job.url, {
      signal: ctl ? ctl.signal : undefined,
      headers: withHeaders(job.url)
    });
    const enabled = this._warmEnabled();
    if (!enabled || (ctl && ctl.signal.aborted)) {
      cancelWarmBody(res && res.body);
      checkWarmAbort(ctl, enabled);
    }
    if (!res || !res.ok) {
      cancelWarmBody(res && res.body);
      this._warmNote('e', job.chan);
      return null;
    }
    const len = parseInt(res.headers.get('content-length') || '0', 10);
    if (len > cap) {
      try { console.log('[warm] skip ' + len + 'B > cap ' + cap + 'B ' + redactUrl(job.url)); } catch (e) {}
      cancelWarmBody(res.body);
      return null;
    }
    
    if (!res.body || !res.body.getReader) {
      cancelWarmBody(res.body);
      this._warmNote('e', job.chan);
      return null;
    }
    return readCapped(res.body.getReader(), cap, ctl, () => this._warmEnabled());
  }

  
  
  
  
  
  
  
  
  
  
  
  
  
  
  warmStatus() {
    const held = this._warmHeld || 0;
    let note = held ? missNote() : this._note || '';
    
    
    
    
    
    
    
    
    
    
    //
    
    
    
    //
    
    
    
    
    if (held && note.charAt(0) === 'w') {
      note += this._wasWarmed(this._rawUrl) ? this._noteOf(this._rawUrl) || '?' : '-';
    }
    return {
      hit: segHits() > 0,
      held,
      note,
      
      
      
      
      
      
      
      
      align: this._alignNote || '',
      
      
      win: this._alignWin || null,
      
      seg: missDetail(),
      
      
      
      wait: waitDiag()
    };
  }

  
  
  _wasWarmed(rawUrl) {
    if (!rawUrl || !this._prefetched) return false;
    const t = this._prefetched.get(rawUrl);
    return !!t && Date.now() - t < 60000;
  }

  
  // Fire-and-forget manifest hit for remux URLs. The server starts its
  // background master fetch on manifest access, so this primes the cache
  // before the real segment request lands.
  prewarm(rawUrl, headers = null) {
    if (!rawUrl || !isRemuxUrl(rawUrl)) return;
    const now = Date.now();
    if (now - (this._prewarmAt.get(rawUrl) || 0) < PREWARM_DEDUPE_MS) return;
    this._prewarmAt.set(rawUrl, now);
    if (this._prewarmAt.size > 64) {
      for (const [key, ts] of this._prewarmAt) {
        if (now - ts >= PREWARM_DEDUPE_MS) this._prewarmAt.delete(key);
      }
    }
    const prev = this._prewarmCtl.get(rawUrl);
    if (prev) { try { prev.abort(); } catch (e) {} }
    const ctl = new AbortController();
    this._prewarmCtl.set(rawUrl, ctl);
    const timer = setTimeout(() => { try { ctl.abort(); } catch (e) {} }, PREWARM_TIMEOUT_MS);
    const init = { signal: ctl.signal, cache: 'no-store' };
    const merged = withHeaders(rawUrl, { Range: 'bytes=0-0' });
    if (merged) init.headers = merged;
    if (typeof fetch !== 'function') {
      clearTimeout(timer);
      this._prewarmCtl.delete(rawUrl);
      return;
    }
    fetch(proxied(rawUrl), init).then((res) => {
      if (res && res.body && typeof res.body.cancel === 'function') {
        try { res.body.cancel(); } catch (e) {}
      }
      try { console.log('[prewarm] ' + (res && res.status) + ' ' + redactUrl(rawUrl)); } catch (e) {}
    }).catch(() => {
      try { console.log('[prewarm] failed ' + redactUrl(rawUrl)); } catch (e) {}
    }).finally(() => {
      clearTimeout(timer);
      if (this._prewarmCtl && this._prewarmCtl.get(rawUrl) === ctl) this._prewarmCtl.delete(rawUrl);
    });
  }

  playLive(channel, decoder = 'auto') {
    this.mode = 'live';
    this.current = { channel, programme: null, url: channel.url };
    this._resetRate();
    this.prewarm(channel.url, channel.headers);
    this._load(channel.url, decoder);
  }

  
  
  playCatchup(channel, programme, url, decoder = 'auto', resumeAt = 0) {
    this.mode = 'catchup';
    this.current = { channel, programme, url };
    this._resetRate();
    this._resumeAt = isFinite(resumeAt) && resumeAt > 0 ? resumeAt : 0;
    this._load(url, decoder);
  }

  isCatchup() {
    return this.mode === 'catchup';
  }

  
  
  
  _vodExpect() {
    if (this.mode !== 'catchup') return null;
    const p = this.current && this.current.programme;
    const dur = p && p.stop && p.start ? (p.stop - p.start) / 1000 : 0;
    return { dur };
  }

  
  seek(deltaSec) {
    if (!isFinite(this.video.duration) && this.mode === 'live') return;
    this.seekTo(this.position() + deltaSec);
  }

  
  seekTo(sec) {
    this._resumeAt = 0;
    try {
      this.video.currentTime = Math.max(0, sec);
    } catch (e) {}
  }

  
  position() {
    if (this._resumeAt > 0) return this._resumeAt;
    return this.video.currentTime || 0;
  }

  _wantEngine() {
    return this.mode === 'catchup' && this.rate !== 1 && !this._engineBlocked &&
      !!(this._speedCap && this._speedCap.ok);
  }

  
  speedBlocked() {
    if (this.mode !== 'catchup') return 'live';
    if (this._engineBlocked) return this._engineBlocked;
    if (this._activePath === 'native') return 'native';
    if (!this._speedCap) return 'detect';
    if (!this._speedCap.ok) return this._speedCap.reason || 'detect';
    return '';
  }

  
  setRate(rate) {
    if (this.mode !== 'catchup') return 1;
    const r = clampRate(rate);
    const blocked = r !== 1 ? this.speedBlocked() : '';
    if (blocked) {
      if (this.onRateFail) this.onRateFail(blocked);
      return this.rate;
    }
    this.rate = r;
    clearTimeout(this._rateTimer);
    this._rateTimer = setTimeout(() => this._applyRate(), RATE_APPLY_MS);
    return r;
  }

  
  rateSettling() {
    return this.rate !== this._appliedRate || this._resumeAt > 0;
  }

  _applyRate() {
    this._rateTimer = null;
    if (this.mode !== 'catchup' || !this.current || this._activePath !== 'hls') return;
    if (this.rate === this._appliedRate) return;
    this._reloadAt(this.position());
  }

  _reloadAt(pos) {
    this._resumeAt = pos > 1 ? pos : 0;
    this._load(this.current.url, this._decoder);
  }

  
  _engineFail(reason) {
    if (!this.engine || !this.current) return;
    const pos = this.position(); 
    this._dropRate(reason);
    this._reloadAt(pos);
  }

  _dropRate(reason) {
    clearTimeout(this._rateTimer);
    this._rateTimer = null;
    this._engineBlocked = reason;
    this.rate = 1;
    if (this.onRateFail) this.onRateFail(reason);
  }

  _resetRate() {
    clearTimeout(this._rateTimer);
    this._rateTimer = null;
    this.rate = 1;
    this._engineBlocked = '';
    this._resumeAt = 0;
  }

  
  primeAudio() {
    try {
      primeAudio();
    } catch (e) {}
  }

  
  rateStats() {
    return this.engine ? this.engine.stats() : null;
  }

  
  
  activePath() {
    return this._activePath || '';
  }

  
  
  
  markTuningDirty() {
    this._tuningDirty = true;
  }

  setAspect(aspect) {
    this.video.classList.remove('aspect-fill', 'aspect-43');
    if (aspect === 'fill') this.video.classList.add('aspect-fill');
    else if (aspect === '4:3') this.video.classList.add('aspect-43');
  }

  stop() {
    this._abortWarm(null);
    if (this._prewarmCtl) {
      for (const ctl of this._prewarmCtl.values()) { try { ctl.abort(); } catch (e) {} }
      this._prewarmCtl.clear();
    }
    this._resetRate();
    this._destroyHls();
    clearTimeout(this._nativeReloadTimer);
    this._nativeReloadTimer = null;
    
    
    this.current = null;
    this._activePath = '';
    try {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();
    } catch (e) {}
  }
}
