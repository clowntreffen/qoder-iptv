import { KEY } from '../core/keys.js';
import { epgStore } from '../core/epgStore.js';
import { esc } from '../core/util.js';
import { t, getLang } from '../core/i18n.js';

const RESULT_MAX = 200;

function nowTitle(channel) {
  const now = Date.now();
  for (const p of epgStore.getList(channel)) {
    const stop = isNaN(p.stop) ? p.start + 3600000 : p.stop;
    if (now >= p.start && now < stop) return p.title || '';
  }
  return '';
}

export function searchChannels(channels, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return (channels || []).slice(0, RESULT_MAX);
  const terms = q.split(/\s+/).filter(Boolean);
  return (channels || [])
    .filter((ch) => {
      const hay = [ch.name, ch.group, ch.chno, ch.index].map((v) => String(v || '').toLowerCase()).join(' ');
      return terms.every((term) => hay.includes(term));
    })
    .slice(0, RESULT_MAX);
}

export class Search {
  constructor(el) {
    this.el = el;
    this.channels = [];
    this.query = '';
    this.sel = 0;
    this.results = [];
    this.onPlay = null;
    this.onClose = null;
    this.onToast = null;
    this._lang = '';
    this.el.addEventListener('click', (e) => this._onClick(e));
    this.el.addEventListener('input', (e) => {
      if (!e.target || e.target.id !== 'search-input') return;
      this.query = e.target.value || '';
      this.sel = 0;
      this._renderResults();
    });
  }

  open(channels, currentKey) {
    this.channels = channels || [];
    this.query = '';
    this.el.classList.remove('hidden');
    this._ensureSkeleton();
    this.results = searchChannels(this.channels, '');
    const current = this.results.findIndex((c) => c.key === currentKey);
    this.sel = current >= 0 ? current : 0;
    this._renderResults();
    const input = this.el.querySelector('#search-input');
    if (input) {
      input.value = '';
      try { input.focus(); } catch (e) {}
    }
  }

  close() {
    this.el.classList.add('hidden');
    const input = this.el.querySelector('#search-input');
    if (input) {
      try { input.blur(); } catch (e) {}
    }
    if (this.onClose) this.onClose();
  }

  isOpen() {
    return !this.el.classList.contains('hidden');
  }

  _ensureSkeleton() {
    if (this._lang === getLang() && this.el.querySelector('#search-input')) {
      this._lang = getLang();
      return;
    }
    this._lang = getLang();
    this.el.innerHTML = `
      <div class="panel search-panel">
        <div class="panel-close" data-role="close">✕</div>
        <h2>${t('search.title')}</h2>
        <input id="search-input" class="search-input" type="search" autocomplete="off" spellcheck="false" placeholder="${esc(t('search.placeholder'))}">
        <div class="search-count" id="search-count"></div>
        <div class="src-list search-results" id="search-results"></div>
        <div class="hint">${t('search.hint')}</div>
      </div>`;
    const input = this.el.querySelector('#search-input');
    if (input) input.value = this.query;
  }

  _onClick(e) {
    const item = e.target.closest('[data-role]');
    if (!item) {
      if (!e.target.closest('.panel')) this.close();
      return;
    }
    const role = item.dataset.role;
    if (role === 'close') {
      this.close();
    } else if (role === 'result') {
      this.sel = parseInt(item.dataset.idx, 10) || 0;
      this._confirm();
    }
  }

  _renderResults() {
    const list = this.el.querySelector('#search-results');
    const count = this.el.querySelector('#search-count');
    if (!list) return;
    this.results = searchChannels(this.channels, this.query);
    if (this.sel >= this.results.length) this.sel = Math.max(0, this.results.length - 1);
    if (this.sel < 0) this.sel = 0;
    if (count) {
      count.textContent = t('search.count', { n: this.results.length });
    }
    list.innerHTML = this.results.length
      ? this.results.map((ch, i) => {
          return `<div class="search-row${i === this.sel ? ' focused' : ''}" data-role="result" data-idx="${i}">
            <span class="num">${esc(String(ch.chno || ch.index))}</span>
            <span class="meta"><span class="name">${esc(ch.name)}</span><span class="group">${esc(ch.group)}</span><span class="now">${esc(nowTitle(ch))}</span></span>
          </div>`;
        }).join('')
      : `<div class="cm-empty">${t('search.empty')}</div>`;
    const focused = list.querySelector('.focused');
    if (focused && focused.scrollIntoView) focused.scrollIntoView({ block: 'center' });
  }

  _move(dir) {
    const n = this.results.length;
    if (!n) return;
    this.sel = (this.sel + dir + n) % n;
    this._renderResults();
  }

  _confirm() {
    const ch = this.results[this.sel];
    if (!ch) return;
    if (this.onPlay) this.onPlay(ch);
    this.close();
  }

  render() {
    if (!this.isOpen()) return;
    this._ensureSkeleton();
    this._renderResults();
  }

  handleKey(code) {
    switch (code) {
      case KEY.UP:
        this._move(-1);
        return true;
      case KEY.DOWN:
        this._move(1);
        return true;
      case KEY.OK:
        this._confirm();
        return true;
      case KEY.BACK:
        this.close();
        return true;
      default:
        return false;
    }
  }
}
