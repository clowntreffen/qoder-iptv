
import { fmtClock, fmtDate, esc } from '../core/util.js';
import { t } from '../core/i18n.js';

export class StatusBar {
  constructor(el) {
    this.el = el;
    this.sourceName = '';
    this.channelCount = 0;
    this.timer = null;
    this.hideTimer = null;
  }

  setSource(name, count) {
    this.sourceName = name || '';
    this.channelCount = count || 0;
  }

  _render() {
    const online = navigator.onLine;
    this.el.innerHTML = `
      <div class="sb-source">${esc(this.sourceName || t('sb.noSource'))}</div>
      <div class="sb-mid">${t('sb.channelCount', { n: this.channelCount })}</div>
      <div class="sb-right">
        <span class="sb-net ${online ? 'online' : 'offline'}">${online ? t('sb.online') : t('sb.offline')}</span>
        <span class="sb-date">${fmtDate()}</span>
        <span class="sb-clock">${fmtClock()}</span>
      </div>
    `;
  }

  show(duration = 5000) {
    this._render();
    this.el.classList.remove('hidden');
    clearInterval(this.timer);
    this.timer = setInterval(() => this._render(), 1000);
    
    
    clearTimeout(this.hideTimer);
    this.hideTimer = null;
    if (duration > 0) {
      this.hideTimer = setTimeout(() => this.hide(), duration);
    }
  }

  hide() {
    clearInterval(this.timer);
    clearTimeout(this.hideTimer);
    this.hideTimer = null;
    this.el.classList.add('hidden');
  }

  isVisible() {
    return !this.el.classList.contains('hidden');
  }
}
