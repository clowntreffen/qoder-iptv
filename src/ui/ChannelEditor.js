

import { KEY } from '../core/keys.js';
import { esc } from '../core/util.js';
import { t } from '../core/i18n.js';
import { getChannelOverrides, setChannelOverrides } from '../core/storage.js';
import { getOverride, patchOverride, clearOverride, moveChannel } from '../core/channelCustomization.js';

const OFFSETS = [-120, -90, -60, -30, -15, 0, 15, 30, 60, 90, 120];
const ROWS = ['name', 'hidden', 'group', 'up', 'down', 'offset', 'reset'];

export class ChannelEditor {
  constructor(el) {
    this.el = el;
    this.ch = null;
    this.focusIdx = 0;
    this.map = {};
    this.groups = [];
    this.siblings = [];
    this.entering = false;
    this.draft = '';
    this.onChanged = null; 
    this.onClose = null;
    this.el.addEventListener('click', (e) => this._onClick(e));
    this.el.addEventListener('input', (e) => {
      if (!this.entering) return;
      const inp = e.target;
      if (inp && inp.id === 'ce-name-input') this.draft = inp.value || '';
    });
  }

  open(ch, opts = {}) {
    this.ch = ch;
    this.map = getChannelOverrides();
    this.groups = Array.isArray(opts.groups) ? opts.groups.slice() : [];
    this.siblings = Array.isArray(opts.siblings) ? opts.siblings.slice() : [];
    this.focusIdx = 0;
    this.entering = false;
    this.draft = '';
    this.el.classList.remove('hidden');
    this.render();
  }

  close() {
    this.el.classList.add('hidden');
    this.ch = null;
    this.entering = false;
    if (this.onClose) this.onClose();
  }

  isOpen() {
    return !this.el.classList.contains('hidden');
  }

  _ov() {
    return getOverride(this.map, this.ch && this.ch.key) || {};
  }

  _offsetValue(n) {
    return n === 0 ? t('ce.offsetZero') : t('ce.offsetUnit', { n });
  }

  _groupValue() {
    return this._ov().group || this.ch.group || '';
  }

  render() {
    if (!this.isOpen() || !this.ch) return;
    const ov = this._ov();
    const rows = [
      { key: 'name', label: t('ce.name'), value: ov.name || this.ch.name || '' },
      { key: 'hidden', label: t('ce.hidden'), value: ov.hidden ? t('ce.hiddenOn') : t('ce.hiddenOff') },
      { key: 'group', label: t('ce.group'), value: this._groupValue() },
      { key: 'up', label: t('ce.moveUp'), value: '' },
      { key: 'down', label: t('ce.moveDown'), value: '' },
      { key: 'offset', label: t('ce.epgOffset'), value: this._offsetValue(ov.epgOffsetMinutes || 0) },
      { key: 'reset', label: t('ce.reset'), value: '' }
    ];
    const list = rows.map((r, i) => {
      const cls = 'form-row' + (i === this.focusIdx ? ' focused' : '');
      const val = r.key === 'reset' || r.key === 'up' || r.key === 'down'
        ? ''
        : `<span class="value">${esc(r.value)}</span>`;
      return `<div class="${cls}" data-role="row" data-idx="${i}"><span class="label">${esc(r.label)}</span>${val}</div>`;
    }).join('');

    const input = this.entering
      ? `<div class="ce-input-row"><input id="ce-name-input" class="search-input" type="text" value="${esc(this.draft)}" placeholder="${esc(t('ce.nameHint'))}"></div>`
      : '';

    this.el.innerHTML = `
      <div class="panel">
        <div class="panel-close" data-role="close">✕</div>
        <h2>${t('ce.title')}</h2>
        <div class="hint">${esc(t('ce.current', { name: this.ch.name }))}</div>
        <div class="src-list">${list}</div>
        ${input}
        <div class="hint">${this.entering ? esc(t('ce.enterHint')) : esc(t('ce.hint'))}</div>
      </div>`;

    if (this.entering) {
      const inp = this.el.querySelector('#ce-name-input');
      if (inp) { try { inp.focus(); } catch (e) {} }
    } else {
      const focused = this.el.querySelector('.focused');
      if (focused && focused.scrollIntoView) focused.scrollIntoView({ block: 'center' });
    }
  }

  _apply(nextMap) {
    this.map = nextMap;
    setChannelOverrides(nextMap);
    if (this.onChanged) this.onChanged();
    this.render();
  }

  _commit() {
    if (!this.ch) return;
    const row = ROWS[this.focusIdx];
    if (row === 'name') {
      this.draft = this._ov().name || this.ch.name || '';
      this.entering = true;
      this.render();
      return;
    }
    if (row === 'hidden') {
      const ov = this._ov();
      this._apply(patchOverride(this.map, this.ch.key, { hidden: !ov.hidden }));
      return;
    }
    if (row === 'group') {
      this._stepGroup(1);
      return;
    }
    if (row === 'up') {
      this._move(-1);
      return;
    }
    if (row === 'down') {
      this._move(1);
      return;
    }
    if (row === 'offset') {
      this._stepOffset(1);
      return;
    }
    if (row === 'reset') {
      this._apply(clearOverride(this.map, this.ch.key));
    }
  }

  _move(dir) {
    if (!this.siblings.length) return;
    const next = moveChannel(this.map, this.siblings, this.ch.key, dir);
    if (next === this.map) return;
    this._apply(next);
  }

  _stepGroup(dir) {
    const base = this.ch.baseGroup || this.ch.group;
    const groups = this.groups.length ? this.groups : [base];
    const cur = this._ov().group || base;
    let i = groups.indexOf(cur);
    if (i < 0) i = groups.indexOf(base);
    if (i < 0) i = 0;
    const next = groups[(i + dir + groups.length) % groups.length];
    // A regrouped channel keeps its rank, which would place it at the old
    // position of the target group; clearing the rank lets it join normally.
    this._apply(patchOverride(this.map, this.ch.key, {
      group: next === base ? null : next,
      order: next === base ? this._ov().order : null
    }));
  }

  _stepOffset(dir) {
    const cur = this._ov().epgOffsetMinutes || 0;
    let i = OFFSETS.indexOf(cur);
    if (i < 0) i = OFFSETS.indexOf(0);
    const next = OFFSETS[(i + dir + OFFSETS.length) % OFFSETS.length];
    this._apply(patchOverride(this.map, this.ch.key, { epgOffsetMinutes: next }));
  }

  _submitName() {
    const name = this.draft.trim();
    const ov = this._ov();
    this.entering = false;
    if (name && name !== (ov.name || this.ch.name)) {
      this._apply(patchOverride(this.map, this.ch.key, { name }));
      return;
    }
    this.render();
  }

  _onClick(e) {
    if (!e.target.closest('.panel')) { this.close(); return; }
    const hit = e.target.closest('[data-role]');
    if (!hit) return;
    if (hit.dataset.role === 'close') { this.close(); return; }
    const rowEl = hit.closest('[data-idx]');
    const idx = rowEl ? parseInt(rowEl.dataset.idx, 10) : NaN;
    if (isNaN(idx)) return;
    this.focusIdx = idx;
    this.render();
    this._commit();
  }

  handleKey(code) {
    if (!this.isOpen()) return false;
    if (this.entering) {
      if (code === KEY.OK) { this._submitName(); return true; }
      if (code === KEY.BACK) { this.entering = false; this.render(); return true; }
      return true; 
    }
    switch (code) {
      case KEY.UP:
        this.focusIdx = Math.max(0, this.focusIdx - 1);
        this.render();
        return true;
      case KEY.DOWN:
        this.focusIdx = Math.min(ROWS.length - 1, this.focusIdx + 1);
        this.render();
        return true;
      case KEY.LEFT:
        if (ROWS[this.focusIdx] === 'offset') this._stepOffset(-1);
        else if (ROWS[this.focusIdx] === 'group') this._stepGroup(-1);
        return true;
      case KEY.RIGHT:
        if (ROWS[this.focusIdx] === 'offset') this._stepOffset(1);
        else if (ROWS[this.focusIdx] === 'group') this._stepGroup(1);
        return true;
      case KEY.OK:
        this._commit();
        return true;
      case KEY.BACK:
        this.close();
        return true;
      default:
        return false;
    }
  }
}
