import { KEY, digitOf } from '../core/keys.js';
import { esc } from '../core/util.js';
import { t, getLang } from '../core/i18n.js';

export class PinEntry {
  constructor(el) {
    this.el = el;
    this.value = '';
    this.length = 4;
    this.title = '';
    this.prompt = '';
    this.error = false;
    this.onSubmit = null;
    this.onCancel = null;
    this._lang = '';
    this.el.addEventListener('click', (e) => this._onClick(e));
  }

  open({ title, prompt, length = 4, onSubmit, onCancel } = {}) {
    this.value = '';
    this.error = false;
    this.title = title || t('pin.title');
    this.prompt = prompt || t('pin.prompt');
    this.length = length;
    this.onSubmit = onSubmit || null;
    this.onCancel = onCancel || null;
    this.el.classList.remove('hidden');
    this.render();
  }

  close(cancelled = false) {
    this.el.classList.add('hidden');
    this.value = '';
    const cb = this.onCancel;
    this.onSubmit = null;
    this.onCancel = null;
    if (cancelled && cb) cb();
  }

  isOpen() {
    return !this.el.classList.contains('hidden');
  }

  render() {
    if (!this.isOpen()) return;
    this._lang = getLang();
    const dots = Array.from({ length: this.length }, (_, i) =>
      `<span class="pin-dot${i < this.value.length ? ' on' : ''}"></span>`
    ).join('');
    const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]
      .map((n, i) => {
        const cls = 'pin-key' + (i === 9 ? ' zero' : '');
        return `<div class="${cls}" data-role="digit" data-digit="${n}">${n}</div>`;
      })
      .join('');
    this.el.innerHTML = `
      <div class="pin-box">
        <div class="pin-title">${esc(this.title)}</div>
        <div class="pin-prompt">${this.error ? esc(t('pin.wrong')) : esc(this.prompt)}</div>
        <div class="pin-dots">${dots}</div>
        <div class="pin-pad">${digits}</div>
        <div class="pin-actions">
          <div class="exit-btn" data-role="cancel">${t('pin.cancel')}</div>
          <div class="exit-btn${this.value.length === this.length ? ' focused' : ''}" data-role="ok">${t('pin.ok')}</div>
        </div>
      </div>`;
  }

  _onClick(e) {
    const item = e.target.closest('[data-role]');
    if (!item) return;
    const role = item.dataset.role;
    if (role === 'digit') this._add(item.dataset.digit);
    else if (role === 'cancel') this.close(true);
    else if (role === 'ok') this._submit();
  }

  _add(digit) {
    if (!this.isOpen() || this.value.length >= this.length) return;
    this.value += String(digit);
    this.error = false;
    if (this.value.length === this.length) this._submit();
    else this.render();
  }

  _submit() {
    if (this.value.length !== this.length) return;
    const ok = this.onSubmit ? this.onSubmit(this.value) : true;
    if (ok === false) {
      this.value = '';
      this.error = true;
      this.render();
      return;
    }
    this.close(false);
  }

  handleKey(code) {
    const digit = digitOf(code);
    if (digit !== null) {
      this._add(digit);
      return true;
    }
    if (code === KEY.BACK) {
      this.close(true);
      return true;
    }
    if (code === KEY.OK) {
      this._submit();
      return true;
    }
    return true;
  }
}
