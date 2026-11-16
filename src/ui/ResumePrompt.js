
import { KEY } from '../core/keys.js';
import { esc } from '../core/util.js';
import { t } from '../core/i18n.js';

const ACTIONS = ['resume', 'start-over', 'cancel'];

function fmtPosition(sec) {
  let s = Math.floor(Number(sec) || 0);
  if (s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(ss)}` : `${p(m)}:${p(ss)}`;
}

export class ResumePrompt {
  constructor(el) {
    this.el = el;
    this.focusIdx = 0;
    this.title = '';
    this.position = 0;
    this.onResume = null;
    this.onStartOver = null;
    this.onCancel = null;
    this.el.addEventListener('click', (e) => this._onClick(e));
  }

  show({ title = '', position = 0, onResume = null, onStartOver = null, onCancel = null } = {}) {
    this.title = title;
    this.position = position;
    this.focusIdx = 0;
    this.onResume = onResume;
    this.onStartOver = onStartOver;
    this.onCancel = onCancel;
    this.el.classList.remove('hidden');
    this.render();
  }

  hide() {
    this.el.classList.add('hidden');
    this.onResume = null;
    this.onStartOver = null;
    this.onCancel = null;
  }

  isOpen() {
    return !this.el.classList.contains('hidden');
  }

  render() {
    if (!this.isOpen()) return;
    const btns = ACTIONS.map((a, i) =>
      `<div class="exit-btn${i === this.focusIdx ? ' focused' : ''}" data-action="${a}">${esc(t('resume.' + a))}</div>`
    ).join('');
    this.el.innerHTML = `
      <div class="resume-box">
        <div class="resume-title">${esc(t('resume.title'))}</div>
        <div class="resume-message">${esc(t('resume.message', { position: fmtPosition(this.position) }))}</div>
        <div class="resume-btns">${btns}</div>
      </div>`;
  }

  _onClick(e) {
    const item = e.target.closest('[data-action]');
    if (!item) return;
    this._activate(item.dataset.action);
  }

  _activate(action) {
    const idx = ACTIONS.indexOf(action);
    if (idx < 0) return;
    const resume = this.onResume;
    const startOver = this.onStartOver;
    const cancel = this.onCancel;
    this.hide();
    if (idx === 0) { if (resume) resume(); }
    else if (idx === 1) { if (startOver) startOver(); }
    else { if (cancel) cancel(); }
  }

  handleKey(code) {
    if (!this.isOpen()) return false;
    if (code === KEY.LEFT || code === KEY.RIGHT) {
      const dir = code === KEY.RIGHT ? 1 : -1;
      const n = ACTIONS.length;
      this.focusIdx = (this.focusIdx + dir + n) % n;
      this.render();
      return true;
    }
    if (code === KEY.OK) {
      this._activate(ACTIONS[this.focusIdx]);
      return true;
    }
    if (code === KEY.BACK) {
      const cancel = this.onCancel;
      this.hide();
      if (cancel) cancel();
      return true;
    }
    return true;
  }
}
