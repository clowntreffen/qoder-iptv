


import { KEY } from '../core/keys.js';
import { t } from '../core/i18n.js';
import { previewTemplateFor, previewUrlFor } from '../core/seekPreview.js';

const HIDE_MS = 6000;
const RATES = [0.5, 1, 1.25, 1.5, 1.75, 2, 2.5];

function fmtSec(s) {
  if (!isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(ss)}` : `${p(m)}:${p(ss)}`;
}

function fmtRate(r) {
  return r + '×';
}

export class CatchupBar {
  constructor(el, player, badgeEl) {
    this.el = el;
    this.player = player;
    this.badge = badgeEl || null; 
    this.programme = null;
    this._row = 'progress';
    this._active = false;
    this._timer = null;
    this._hideTimer = null;
    
    this._preview = null;
    this._previewDir = 0;
    this._repeat = 0;
    this._commitTimer = null;
    this._tplKey = null;
    this._tpl = '';
    this._previewFailed = '';
    this._shownUrl = '';
  }

  get video() {
    return this.player.video;
  }

  show(programme) {
    this.programme = programme || null;
    this._active = true;
    this._row = 'progress';
    this._preview = null;
    this._previewDir = 0;
    this._repeat = 0;
    this._shownUrl = '';
    this._previewFailed = '';
    this._tplKey = null;
    this._tpl = '';
    this.el.classList.remove('hidden');
    this.render();
    this._startTick();
    this._scheduleHide();
    this._syncBadge();
  }

  hide() {
    this._commitSeek(); 
    this.el.classList.add('hidden');
    this._row = 'progress'; 
    this._stopTick();
    clearTimeout(this._hideTimer);
    this._syncBadge();
  }

  
  close() {
    this._active = false;
    this.hide();
  }

  isOpen() {
    return !this.el.classList.contains('hidden');
  }

  
  syncRate() {
    this._renderSpeed();
    this._syncBadge();
  }

  _syncBadge() {
    if (!this.badge) return;
    const r = this.player.rate;
    const on = this._active && !this.isOpen() && this.player.isCatchup() && r !== 1;
    if (on) this.badge.textContent = fmtRate(r);
    this.badge.classList.toggle('hidden', !on);
  }

  _startTick() {
    this._stopTick();
    this._timer = setInterval(() => this._tick(), 500);
  }
  _stopTick() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  _scheduleHide() {
    clearTimeout(this._hideTimer);
    this._hideTimer = setTimeout(() => this.hide(), HIDE_MS);
  }

  
  
  _progress() {
    const v = this.video;
    let dur = v && isFinite(v.duration) ? v.duration : NaN;
    if (!isFinite(dur) && this.programme && this.programme.stop && this.programme.start) {
      dur = (this.programme.stop - this.programme.start) / 1000;
    }
    const cur = this._preview != null ? this._preview : this.player.position();
    const pct = isFinite(dur) && dur > 0 ? Math.min(100, (cur / dur) * 100) : 0;
    return { cur, dur, pct };
  }

  
  _seekStep() {
    const { dur } = this._progress();
    const base = isFinite(dur) && dur > 0 ? Math.max(10, dur * 0.02) : 30;
    const accel = Math.min(8, 1 + Math.floor(this._repeat / 3));
    return base * accel;
  }

  
  _seekBy(dir) {
    const { dur } = this._progress();
    if (this._previewDir === dir) this._repeat += 1;
    else { this._repeat = 0; this._previewDir = dir; }

    const from = this._preview != null ? this._preview : this.player.position();
    let next = from + dir * this._seekStep();
    const max = isFinite(dur) && dur > 0 ? dur - 1 : Infinity;
    this._preview = Math.min(max, Math.max(0, next));
    this._tick();

    clearTimeout(this._commitTimer);
    this._commitTimer = setTimeout(() => this._commitSeek(), 400);
  }

  
  _commitSeek() {
    clearTimeout(this._commitTimer);
    this._commitTimer = null;
    if (this._preview == null) return;
    const target = this._preview;
    this._preview = null;
    this._previewDir = 0;
    this._repeat = 0;
    this._shownUrl = '';
    this.player.seekTo(target);
    this._tick();
  }

  
  _stepRate(dir) {
    this.player.primeAudio();
    let i = RATES.indexOf(this.player.rate);
    if (i < 0) i = RATES.indexOf(1);
    const j = Math.min(RATES.length - 1, Math.max(0, i + dir));
    if (j !== i) this._setRate(RATES[j]);
  }

  _setRate(r) {
    this.player.setRate(r);
    this._renderSpeed();
  }

  _focusRow(row) {
    if (row !== this._row) this._commitSeek();
    this._row = row;
    this.el.querySelectorAll('[data-role]').forEach((n) => {
      n.classList.toggle('focused', n.dataset.role === row);
    });
  }

  
  _tick() {
    const { cur, dur, pct } = this._progress();
    const fill = this.el.querySelector('.cb-fill');
    const knob = this.el.querySelector('.cb-knob');
    const curEl = this.el.querySelector('.cb-cur');
    const durEl = this.el.querySelector('.cb-dur');
    if (fill) fill.style.width = pct + '%';
    if (knob) knob.style.left = pct + '%';
    if (curEl) {
      curEl.textContent = fmtSec(cur);
      curEl.classList.toggle('seeking', this._preview != null);
    }
    if (durEl) durEl.textContent = isFinite(dur) && dur > 0 ? fmtSec(dur) : '--:--';
    this._updateSpeedNote();
    this._updatePreview();
  }

  // Wall clock of the preview target. Programme times are already shifted for
  // the channel's EPG offset, so the raw entry is the safer base.
  _mediaToUtc(sec) {
    const programme = this.programme;
    const raw = programme && (programme._epg || programme);
    if (!raw || !isFinite(raw.start)) return null;
    return Math.floor(raw.start / 1000) + Math.max(0, Math.floor(sec));
  }

  _template() {
    const channel = this.player.current && this.player.current.channel;
    if (!channel) return '';
    if (this._tplKey !== channel.key) {
      this._tplKey = channel.key;
      this._tpl = previewTemplateFor(channel);
    }
    return this._tpl;
  }

  _updatePreview() {
    const box = this.el.querySelector('.cb-preview');
    if (!box) return;
    if (this._preview == null || this._previewFailed === this._template()) {
      box.classList.add('hidden');
      return;
    }
    const img = box.querySelector('img');
    const utc = this._mediaToUtc(this._preview);
    if (!img || utc == null) {
      box.classList.add('hidden');
      return;
    }
    const url = previewUrlFor(this._template(), utc);
    if (!url) {
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
    if (url === this._shownUrl) return;
    this._shownUrl = url;
    img.onerror = () => {
      // One dead preview URL means the provider is wrong for this channel;
      // stop asking instead of flashing a broken frame on every key.
      this._previewFailed = this._template();
      this._shownUrl = '';
      box.classList.add('hidden');
    };
    img.src = url;
  }

  
  _updateSpeedNote() {
    const note = this.el.querySelector('.cb-note');
    if (!note) return;
    const p = this.player;
    const reason = p.speedBlocked();
    const pending = p.rateSettling();
    const on = this.el.querySelector('.cb-rate.on');
    if (on) on.classList.toggle('pending', pending);
    let text = t('cb.speedHint');
    if (reason && reason !== 'live') {
      text = t('rate.' + reason);
    } else {
      const s = p.rateStats();
      if (s) text = this._diag(s);
    }
    note.textContent = text;
    note.classList.toggle('warn', !!reason);
  }

  _diag(s) {
    const parts = [s.path];
    if (isFinite(s.drift)) parts.push('drift ' + Math.round(s.drift * 1000) + 'ms');
    parts.push('under ' + (s.underruns || 0));
    if (s.decErrors) parts.push('err ' + s.decErrors);
    if (isFinite(s.dropped)) parts.push('drop ' + (s.dropped * 100).toFixed(1) + '%');
    return parts.join(' · ');
  }

  _speedInner() {
    const cur = this.player.rate;
    const items = RATES.map(
      (r) => `<span class="cb-rate${r === cur ? ' on' : ''}" data-rate="${r}">${fmtRate(r)}</span>`
    ).join('');
    return `<span class="cb-label">${t('cb.speed')}</span><div class="cb-rates">${items}</div><span class="cb-note"></span>`;
  }

  _renderSpeed() {
    const row = this.el.querySelector('.cb-speed-row');
    if (!row) return;
    row.innerHTML = this._speedInner();
    this._updateSpeedNote();
  }

  render() {
    const { cur, dur, pct } = this._progress();
    const title = this.programme ? this.programme.title : t('cb.catchup');
    const f = (row) => (this._row === row ? ' focused' : '');

    this.el.innerHTML = `
      <div class="cb-title">${t('cb.title', { title: this._esc(title) })}</div>
      <div class="cb-preview hidden"><img alt=""></div>
      <div class="cb-progress-row${f('progress')}" data-role="progress">
        <span class="cb-cur">${fmtSec(cur)}</span>
        <div class="cb-bar"><i class="cb-fill" style="width:${pct}%"></i><b class="cb-knob" style="left:${pct}%"></b></div>
        <span class="cb-dur">${isFinite(dur) && dur > 0 ? fmtSec(dur) : '--:--'}</span>
      </div>
      <div class="cb-speed-row${f('speed')}" data-role="speed">${this._speedInner()}</div>
    `;
    this._shownUrl = '';
    this._updateSpeedNote();
    this._updatePreview();
  }

  _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
    );
  }

  handleKey(code) {
    switch (code) {
      
      
      case KEY.UP:
      case KEY.DOWN:
        if (this.isOpen()) this._focusRow(this._row === 'progress' ? 'speed' : 'progress');
        else this._ensureVisible();
        this._scheduleHide();
        return true;
      case KEY.LEFT:
      case KEY.RIGHT: {
        const dir = code === KEY.LEFT ? -1 : 1;
        this._ensureVisible();
        if (this._row === 'speed') this._stepRate(dir);
        else this._seekBy(dir);
        this._scheduleHide();
        return true;
      }
      case KEY.OK:
        
        if (this._preview != null) {
          this._commitSeek();
          this._scheduleHide();
          return true;
        }
        return false;
      default:
        return false;
    }
  }

  
  onClick(e) {
    const rate = e.target.closest('[data-rate]');
    if (rate) {
      this.player.primeAudio();
      this._ensureVisible();
      this._focusRow('speed');
      this._setRate(Number(rate.dataset.rate));
      this._scheduleHide();
      return true;
    }
    const item = e.target.closest('[data-role]');
    if (!item) return false;
    this._ensureVisible();
    this._focusRow(item.dataset.role);
    this._scheduleHide();
    return true;
  }

  _ensureVisible() {
    if (!this.isOpen()) {
      this.el.classList.remove('hidden');
      this.render();
      this._startTick();
      this._syncBadge();
    }
  }
}
