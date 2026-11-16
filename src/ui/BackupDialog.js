import { KEY } from '../core/keys.js';
import { esc } from '../core/util.js';
import { t, getLang } from '../core/i18n.js';

const ROLES = ['copy', 'restore', 'close'];

export class BackupDialog {
  constructor(el) {
    this.el = el;
    this.mode = 'backup';
    this.focus = 0;
    this.text = '';
    this.onRestore = null;
    this.onToast = null;
    this._lang = '';
    this.el.addEventListener('click', (e) => this._onClick(e));
  }

  open(mode = 'backup', text = '') {
    this.mode = mode === 'restore' ? 'restore' : 'backup';
    this.focus = this.mode === 'restore' ? 1 : 0;
    this.text = String(text || '');
    this.el.classList.remove('hidden');
    this.render();
  }

  close() {
    this.el.classList.add('hidden');
  }

  isOpen() {
    return !this.el.classList.contains('hidden');
  }

  render() {
    if (!this.isOpen()) return;
    this._lang = getLang();
    const isRestore = this.mode === 'restore';
    this.el.innerHTML = `
      <div class="panel backup-panel">
        <div class="panel-close" data-role="close">✕</div>
        <h2>${isRestore ? t('backup.restoreTitle') : t('backup.title')}</h2>
        <div class="hint">${isRestore ? t('backup.restoreHint') : t('backup.hint')}</div>
        <textarea id="backup-json" class="backup-json" spellcheck="false" ${isRestore ? '' : 'readonly'}>${esc(this.text)}</textarea>
        <div class="backup-actions">
          <div class="btn${this.focus === 0 ? ' focused' : ''}" data-role="copy">${t('backup.copy')}</div>
          <div class="btn${this.focus === 1 ? ' focused' : ''}" data-role="restore">${t('backup.restore')}</div>
          <div class="btn${this.focus === 2 ? ' focused' : ''}" data-role="close">${t('backup.close')}</div>
        </div>
        <div class="hint">${t('backup.footer')}</div>
      </div>`;
  }

  _text() {
    const box = this.el.querySelector('#backup-json');
    return box ? box.value : this._initial || '';
  }

  _onClick(e) {
    const item = e.target.closest('[data-role]');
    if (!item) return;
    const role = item.dataset.role;
    if (role === 'close') this.close();
    else if (role === 'copy') this._copy();
    else if (role === 'restore') this._restore();
  }

  async _copy() {
    const box = this.el.querySelector('#backup-json');
    const text = box ? box.value : '';
    let ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch (e) {}
    if (!ok && box) {
      try {
        box.focus();
        box.select();
        ok = document.execCommand && document.execCommand('copy');
      } catch (e) {}
    }
    if (this.onToast) this.onToast(ok ? t('toast.backupCopied') : t('toast.backupCopyFailed'));
  }

  _restore() {
    const box = this.el.querySelector('#backup-json');
    const text = box ? box.value.trim() : '';
    if (!text) return;
    let ok = false;
    try {
      ok = this.onRestore ? this.onRestore(text) !== false : true;
    } catch (e) {
      ok = false;
    }
    if (!ok) {
      if (this.onToast) this.onToast(t('toast.restoreFailed'));
      return;
    }
    this.close();
  }

  _move(dir) {
    this.focus = (this.focus + dir + ROLES.length) % ROLES.length;
    this.render();
  }

  handleKey(code) {
    switch (code) {
      case KEY.LEFT:
        this._move(-1);
        return true;
      case KEY.RIGHT:
        this._move(1);
        return true;
      case KEY.OK:
        this._exec(ROLES[this.focus]);
        return true;
      case KEY.BACK:
        this.close();
        return true;
      default:
        return false;
    }
  }

  _exec(role) {
    if (role === 'copy') this._copy();
    else if (role === 'restore') this._restore();
    else this.close();
  }
}
