
//



//


import { KEY } from '../core/keys.js';
import { t } from '../core/i18n.js';
import {
  TUNING_SPECS,
  getTuning,
  saveTuning,
  resetTuning,
  cycleValue,
  formatValue,
  isAllDefault
} from '../player/tuning.js';

export class PlayerTuning {
  constructor(el) {
    this.el = el;
    this.focusIdx = 0;
    this.tuning = getTuning();
    this.activePath = ''; 
    this.dirty = false; 

    this.onApply = null; 
    this.onWarmChange = null;
    this.getWarmStatus = null;
    this.onClose = null;
    this._warmTimer = null;

    this.el.addEventListener('click', (e) => this._onClick(e));
  }

  _onClick(e) {
    
    if (!e.target.closest('.panel')) {
      this.close();
      return;
    }
    const hit = e.target.closest('[data-role]');
    if (!hit) return;
    if (hit.dataset.role === 'close') {
      this.close();
      return;
    }
    const rowEl = hit.closest('[data-idx]');
    const idx = rowEl ? parseInt(rowEl.dataset.idx, 10) : NaN;
    if (isNaN(idx)) return;
    this.focusIdx = idx;
    this.render(); 
    if (hit.dataset.role === 'dec') this._cycle(-1);
    else if (hit.dataset.role === 'inc') this._cycle(1);
    else this._confirm();
  }

  _specs() {
    return TUNING_SPECS.filter((s) => !s.warm || this.tuning.prefetchSegmentBytes > 0);
  }

  
  _rowCount() {
    return this._specs().length + 1;
  }

  open(activePath) {
    this.activePath = activePath || '';
    this.tuning = getTuning();
    this.focusIdx = 0;
    this.dirty = false;
    this.el.classList.remove('hidden');
    this.render();
    clearInterval(this._warmTimer);
    this._warmTimer = setInterval(() => this._refreshWarmStatus(), 1000);
  }

  render() {
    const specs = this._specs();
    this.focusIdx = Math.min(this.focusIdx, specs.length);
    const rows = specs.map((s, i) => {
      const cls = 'form-row' + (i === this.focusIdx ? ' focused' : '');
      const v = this.tuning[s.key];
      
      const valCls = 'value' + (v === s.def ? ' off' : '');
      return `<div class="${cls}" data-role="row" data-idx="${i}" data-key="${s.key}">
          <span class="label">${t('tune.' + s.key)}</span>
          <span class="${valCls}"><b class="arrow" data-role="dec">◄</b>${formatValue(
        s.key,
        v
      )}<b class="arrow" data-role="inc">►</b></span>
        </div>`;
    }).join('');

    
    const pathKey =
      this.activePath === 'hls'
        ? 'tune.pathHls'
        : this.activePath === 'native'
        ? 'tune.pathNative'
        : 'tune.pathIdle';
    const pathColor =
      this.activePath === 'hls' ? '#4fd08a' : this.activePath === 'native' ? '#ffb74d' : '#808a94';

    
    const focusSpec = specs[this.focusIdx];
    const desc = focusSpec
      ? t('tune.' + focusSpec.key + '.d')
      : t(isAllDefault(this.tuning) ? 'tune.allDefault' : 'tune.modified');

    const btnIdx = specs.length;
    this.el.innerHTML = `
      <div class="panel">
        <div class="panel-close" data-role="close">✕</div>
        <h2>${t('tune.title')}</h2>
        <div class="hint" style="color:${pathColor}">${t(pathKey)}</div>
        <div class="hint tune-warm-status${this.tuning.prefetchSegmentBytes > 0 ? '' : ' hidden'}"></div>
        <div class="src-list">${rows}</div>
        <div class="hint tune-desc">${desc}</div>
        <div class="btn-row">
          <div class="btn${this.focusIdx === btnIdx ? ' focused' : ''}" data-role="row" data-idx="${btnIdx}">${t(
      'tune.reset'
    )}</div>
        </div>
        <div class="hint">${t('tune.hint')}</div>
      </div>
    `;
    this._refreshWarmStatus();
    const focused = this.el.querySelector('.focused');
    if (focused && focused.scrollIntoView) focused.scrollIntoView({ block: 'center' });
  }

  _refreshWarmStatus() {
    if (!this.isOpen() || this.tuning.prefetchSegmentBytes <= 0) return;
    const el = this.el.querySelector('.tune-warm-status');
    if (!el) return;
    const status = this.getWarmStatus && this.getWarmStatus();
    el.textContent = status ? t('tune.prefetchStatus', {
      ahead: status.ahead.toFixed(1),
      resume: status.resume.toFixed(1),
      hold: status.hold.toFixed(1)
    }) : t('tune.prefetchIdle');
  }

  _cycle(dir) {
    const spec = this._specs()[this.focusIdx];
    if (!spec) return;
    const value = cycleValue(spec.key, this.tuning[spec.key], dir, this.tuning);
    if (value === this.tuning[spec.key]) return;
    this.tuning[spec.key] = value;
    this.tuning = saveTuning(this.tuning);
    if (spec.warm) {
      if (this.onWarmChange) this.onWarmChange(this.tuning);
    } else {
      
      this.dirty = true;
    }
    this.render();
  }

  _confirm() {
    if (this.focusIdx === this._specs().length) {
      if (!isAllDefault(this.tuning)) {
        this.dirty = this.dirty || TUNING_SPECS.some((s) => !s.warm && this.tuning[s.key] !== s.def);
        this.tuning = resetTuning();
        if (this.onWarmChange) this.onWarmChange(this.tuning);
      }
      this.focusIdx = this._specs().length;
      this.render();
      return;
    }
    this._cycle(1); 
  }

  handleKey(code) {
    switch (code) {
      case KEY.UP:
        this.focusIdx = Math.max(0, this.focusIdx - 1);
        this.render();
        break;
      case KEY.DOWN:
        this.focusIdx = Math.min(this._rowCount() - 1, this.focusIdx + 1);
        this.render();
        break;
      case KEY.LEFT:
        this._cycle(-1);
        break;
      case KEY.RIGHT:
        this._cycle(1);
        break;
      case KEY.OK:
        this._confirm();
        break;
      case KEY.BACK:
        this.close();
        break;
      default:
        return false;
    }
    return true;
  }

  close() {
    clearInterval(this._warmTimer);
    this._warmTimer = null;
    this.el.classList.add('hidden');
    
    const changed = this.dirty;
    this.dirty = false;
    if (changed && this.onApply) this.onApply(this.tuning);
    if (this.onClose) this.onClose();
  }

  isOpen() {
    return !this.el.classList.contains('hidden');
  }
}
