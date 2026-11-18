// Optional on-screen debug view for the live player.
// Shows player/decoder state and a rolling event list. Never contains stream
// URLs: the backend URL is always the same, so it would only add noise.

import { esc } from '../core/util.js';

const MAX_EVENTS = 20;

function fmtAhead(sec) {
  return Number.isFinite(sec) ? sec.toFixed(1) + 's' : '-';
}

export class DebugOverlay {
  constructor(el) {
    this.el = el;
    this.events = [];
    this.visible = false;
    if (this.el) this.el.classList.add('hidden');
  }

  setVisible(v) {
    this.visible = !!v;
    if (this.el) this.el.classList.toggle('hidden', !this.visible);
    if (this.visible) this.render();
  }

  isVisible() {
    return this.visible;
  }

  toggle() {
    this.setVisible(!this.visible);
  }

  logEvent(type, info) {
    const text = String(info == null ? '' : info);
    this.events.push({ t: Date.now(), type: String(type), info: text });
    if (this.events.length > MAX_EVENTS) this.events.shift();
    if (this.visible) this.render();
  }

  clearEvents() {
    this.events.length = 0;
    if (this.visible) this.render();
  }

  _eventLine(entry) {
    const d = new Date(entry.t);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss} ${entry.type}${entry.info ? ' ' + entry.info : ''}`;
  }

  render(state) {
    if (!this.el) return;
    const s = state || {};
    const rows = [
      ['path', s.path || '-'],
      ['readyState', s.readyState],
      ['paused', s.paused],
      ['position', s.position != null ? Number(s.position).toFixed(1) + 's' : '-'],
      ['buffer ahead', fmtAhead(s.ahead)],
      ['level', s.level],
      ['bitrate', s.bitrate != null ? Math.round(s.bitrate / 1000) + ' kbps' : '-'],
      ['audio', s.audioLabel || '-'],
      ['subtitle', s.subtitleLabel || '-'],
      ['video', s.videoCodec || '-'],
      ['audio codec', s.audioCodec || '-'],
      ['size', s.width && s.height ? s.width + 'x' + s.height : '-'],
      ['remux', s.remux ? 'yes' : 'no'],
      ['frag load', s.fragLoadSec != null ? Number(s.fragLoadSec).toFixed(2) + 's' : '-']
    ];
    const status = rows.map(([k, v]) => `<div class="dbg-row"><span>${esc(k)}</span><b>${esc(String(v))}</b></div>`).join('');
    const events = this.events.length
      ? this.events.map((e) => `<div class="dbg-ev">${esc(this._eventLine(e))}</div>`).join('')
      : '<div class="dbg-ev">no events yet</div>';
    this.el.innerHTML = `<div class="dbg-box"><div class="dbg-title">DEBUG</div>${status}<div class="dbg-events">${events}</div></div>`;
  }
}
