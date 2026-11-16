


import { t } from '../core/i18n.js';

const TICK_MS = 1000;
const WINDOW_MS = 3000;




const ALIGN_KEYS = ['nowin', 'ok', 'nodet', 'old', 'off', 'err'];



const SANE_SEG_DIFF = 100;

export class NetSpeed {
  constructor(el, player) {
    this.el = el;
    this.player = player;
    this.timer = null;
    this.samples = []; // [{ at, bytes }]
    this.startupMs = 0; 
    this.bps = 0;
  }

  setEnabled(on) {
    if (on) this.start();
    else this.stop();
  }

  start() {
    if (this.timer) return;
    this.reset();
    this.el.classList.remove('hidden');
    this.timer = setInterval(() => this._tick(), TICK_MS);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.samples = [];
    this.el.classList.add('hidden');
  }

  isOn() {
    return !!this.timer;
  }

  
  reset() {
    this.samples = [];
    this.startupMs = 0; 
    this.warm = null;
    this.phases = null;
    this.bps = 0;
    this._render();
  }

  
  
  
  
  
  setStartupMs(ms, warm, phases) {
    this.startupMs = ms > 0 ? ms : 0;
    this.warm = warm || null;
    this.phases = phases || null;
    this._render();
  }

  _tick() {
    const bytes = this.player.getLoadedBytes();
    const now = Date.now();
    const last = this.samples[this.samples.length - 1];
    if (last && bytes < last.bytes) this.samples = []; 
    this.samples.push({ at: now, bytes });
    while (this.samples.length > 1 && now - this.samples[0].at > WINDOW_MS) this.samples.shift();
    const first = this.samples[0];
    const dt = (now - first.at) / 1000;
    const bps = dt > 0 ? (bytes - first.bytes) / dt : 0;
    this.bps = bps > 0 ? bps : 0;
    this._render();
  }

  _render() {
    const speed = this._fmt(this.bps);
    const top = this.startupMs
      ? (this.startupMs / 1000).toFixed(1) + 's' + this._warmTag() + ' · ' + speed
      : speed;
    
    const phase = this._phaseLine();
    
    
    const warm = this._warmLine();
    const startup = this._startupLines();
    let html = `<div>${top}</div>`;
    if (phase) html += `<div class="net-phase">${phase}</div>`;
    if (warm) html += `<div class="net-warm">${warm}</div>`;
    if (startup) html += startup;
    this.el.innerHTML = phase || warm || startup ? html : top;
  }

  _startupLines() {
    const d = this.player.startupStatus();
    if (!d) return '';
    const seconds = (ms) => ms === null ? '—' : (ms / 1000).toFixed(1) + 's';
    const first = d.frame === null ? t('startup.data') : t('startup.frame');
    const timing = `${first}${seconds(d.frame === null ? d.data : d.frame)} · ` +
      `${t('startup.seek')}${seconds(d.seeked)} · ${t('startup.play')}${seconds(d.playing)} · ` +
      `${t('startup.motion')}${seconds(d.motion)}`;
    const native = d.path === 'native';
    const route = native
      ? t('startup.native') + (d.fallback ? ` ← hls.js (${t('startup.fallback.' + d.fallback)}) ${seconds(d.native)}` : '')
      : 'hls.js';
    const state = t('startup.' + d.reason) +
      (d.nudged ? ' · ' + t(native ? 'startup.nativeCorrected' : 'startup.corrected') : '');
    const buffer = d.ahead === null ? t('startup.bufferUnknown') : t('startup.ahead', { seconds: d.ahead.toFixed(1) });
    return `<div class="net-phase">${route} · R${d.readyState}</div>` +
      `<div class="net-phase">${timing}</div><div class="net-warm">${buffer} · ${state}</div>`;
  }

  
  //
  
  
  
  _warmLine() {
    const w = this.warm;
    if (!w || w.hit) return '';
    const d = w.wait || {};
    const s = (ms) => (ms / 1000).toFixed(1) + 's';
    
    const est = ' · ' + t('ns.est', { warm: s(d.warm || 0), own: s(d.own || 0) }) + (d.ownReal ? '' : t('ns.guess'));
    if (d.act === 'over') return t('ns.takeover', { age: d.age }) + est;
    if (d.act === 'give') return t('ns.giveUp', { budget: d.budget }) + est;
    
    if (!w.held) return '';
    
    
    
    if (w.align === 'nowin' && w.win) {
      const v = w.win;
      const have = v.have || [];
      if (!have.length) return t('ns.noCache', { lo: v.lo, hi: v.hi, n: v.n });
      const seg = have[0] + '~' + have[have.length - 1];
      const inWin = have.some((n) => n >= v.lo && n <= v.hi);
      const why = t(inWin ? 'ns.inWinMiss' : 'ns.slidOut');
      return t('ns.window', { why, lo: v.lo, hi: v.hi, n: v.n, seg });
    }
    const a = ALIGN_KEYS.indexOf(w.align) >= 0
      ? t('ns.align.' + w.align)
      : w.align ? t('ns.alignCode', { code: w.align }) : t('ns.noAlign');
    const g = w.seg || {};
    if (!isFinite(g.want) || !isFinite(g.top)) return a;
    
    
    
    if (Math.abs(g.want - g.top) > SANE_SEG_DIFF)
      return t('ns.stale', { align: a, want: g.want, top: g.top });
    return t('ns.seg', { align: a, want: g.want, top: g.top });
  }

  _phaseLine() {
    const p = this.phases;
    if (!p || !this.startupMs) return '';
    const s = (ms) => (ms / 1000).toFixed(1);
    return t('ns.phase', { manifest: s(p.manifest), frag: s(p.frag), buffer: s(p.buffer) }) + t('startup.waitPlay') + s(p.render);
  }

  
  
  _warmTag() {
    if (!this.warm) return '';
    if (this.warm.hit) return '⚡';
    return '✕' + this.warm.held + (this.warm.note || '');
  }

  _fmt(bps) {
    if (bps >= 1024 * 1024) return (bps / 1024 / 1024).toFixed(1) + ' MB/s';
    return Math.round(bps / 1024) + ' KB/s';
  }
}
