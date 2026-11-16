
import { epgStore } from '../core/epgStore.js';
import { fmtTime, fmtClock, esc, logoHtml } from '../core/util.js';
import { t } from '../core/i18n.js';


function resLabel(w, h) {
  if (!w || !h) return '';
  if (w >= 3000 || h >= 1700) return '4K';
  if (w >= 2000 || h >= 1200) return '2K';
  if (h >= 1000) return '1080P';
  if (h >= 700) return '720P';
  if (h >= 500) return '576P';
  return h + 'P';
}



function audioLabel(codec) {
  const c = String(codec || '').toLowerCase();
  if (!c) return '';
  if (/ec-?3|mp4a\.a6/.test(c)) return t('audio.dolbyPlus');
  if (/ac-?3|mp4a\.a5|dolby/.test(c)) return t('audio.dolby');
  if (/mp4a\.40\.34|mp4a\.6b|mp3|mpeg-?1/.test(c)) return 'MP3';
  if (/mp4a\.40\.5|he-?aac/.test(c)) return 'HE-AAC';
  if (/mp4a|aac/.test(c)) return 'AAC';
  if (/opus/.test(c)) return 'Opus';
  if (/dts/.test(c)) return 'DTS';
  return c.length <= 8 ? codec.toUpperCase() : '';
}


function videoLabel(codec) {
  const c = String(codec || '').toLowerCase();
  if (!c) return '';
  if (/hvc1|hev1|hevc|h\.?265/.test(c)) return 'HEVC';
  if (/av01|av1/.test(c)) return 'AV1';
  if (/avc1|avc3|h\.?264/.test(c)) return 'H.264';
  if (/vp0?9/.test(c)) return 'VP9';
  return '';
}

export class Osd {
  constructor(el) {
    this.el = el;
    this.hideTimer = null;
    this.latTimer = null;
    this.getLatency = null; 
    this.mediaInfo = null; // { width, height, videoCodec, audioCodec }
  }

  
  _fmtHtml() {
    const mi = this.mediaInfo || {};
    const res = resLabel(mi.width, mi.height);
    const vid = videoLabel(mi.videoCodec);
    const aud = audioLabel(mi.audioCodec);
    let html = '';
    if (res) html += `<span class="osd-tag${res === '4K' ? ' tag-4k' : ''}">${esc(res)}</span>`;
    if (vid) html += `<span class="osd-tag tag-video">${esc(vid)}</span>`;
    if (aud) html += `<span class="osd-tag tag-audio">${esc(aud)}</span>`;
    return html;
  }

  
  
  _latHtml() {
    if (!this.getLatency) return '';
    const s = this.getLatency();
    if (s == null || !isFinite(s)) return '';
    return `<span class="osd-tag tag-latency">${esc(t('osd.latency', { s: Math.round(s) }))}</span>`;
  }

  _updateLat() {
    const box = this.el.querySelector('.osd-lat');
    if (box) box.innerHTML = this._latHtml();
  }

  _startLatTimer() {
    clearInterval(this.latTimer);
    this.latTimer = setInterval(() => this._updateLat(), 1000);
  }

  
  
  setMediaInfo(info) {
    this.mediaInfo = info || null;
    const box = this.el.querySelector('.osd-fmt');
    if (box) box.innerHTML = this._fmtHtml();
  }

  
  show(channel, { catchup = false, programme = null, duration = 8000 } = {}) {
    const nn = epgStore.getNowNext(channel);
    const nowProg = programme || nn.now;
    const nextProg = nn.next;

    let progressHtml = '';
    if (catchup && programme && !isNaN(programme.start)) {
      progressHtml = `<div class="osd-badge">${t('osd.catchup')}</div>`;
    }
    
    const nowText = nowProg
      ? t('osd.nowPlaying', { title: esc(nowProg.title), time: fmtTime(nowProg.start) + '-' + fmtTime(nowProg.stop) })
      : t('osd.nowPlayingNone');
    const nextText = nextProg ? t('osd.nextPlaying', { title: esc(nextProg.title), time: fmtTime(nextProg.start) }) : '';
    
    
    let srcHtml = '';
    if (channel.sources && channel.sources.length > 1) {
      const cur = channel.sources[channel.sourceIdx] || channel.sources[0];
      srcHtml = `<div class="osd-src">${t('osd.source', { n: channel.sourceIdx + 1, total: channel.sources.length, label: esc(cur.label) })}</div>`;
    }

    this.el.innerHTML = `
      <div class="osd-num">${esc(String(channel.chno || channel.index))}</div>
      <div class="osd-logo">${logoHtml(channel)}</div>
      <div class="osd-info">
        <div class="osd-name">
          <span class="osd-cname">${esc(channel.name)}</span>
          ${progressHtml}
          <span class="osd-fmt">${this._fmtHtml()}</span>
          <span class="osd-lat">${this._latHtml()}</span>
        </div>
        <div class="osd-prog">${nowText}</div>
        <div class="osd-next">${nextText}</div>
        ${srcHtml}
      </div>
      <div class="osd-time">${fmtClock()}</div>
    `;
    this.el.classList.remove('hidden');
    this._startLatTimer();
    this._autoHide(duration);
  }

  _autoHide(duration) {
    clearTimeout(this.hideTimer);
    if (duration > 0) {
      this.hideTimer = setTimeout(() => this.hide(), duration);
    }
  }

  hide() {
    clearTimeout(this.hideTimer);
    clearInterval(this.latTimer);
    this.latTimer = null;
    this.el.classList.add('hidden');
  }

  isVisible() {
    return !this.el.classList.contains('hidden');
  }
}
