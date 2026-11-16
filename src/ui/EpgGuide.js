
import { KEY } from '../core/keys.js';
import { epgStore } from '../core/epgStore.js';
import { isCatchupAvailable } from '../core/catchup.js';
import { fmtTime, fmtDayLabel, esc } from '../core/util.js';
import { isReminder, toggleReminder } from '../core/reminders.js';
import { t, getLang } from '../core/i18n.js';


const DAY_OFFSETS = [-7, -6, -5, -4, -3, -2, -1, 0, 1, 2];

export class EpgGuide {
  constructor(el) {
    this.el = el;
    this.channels = [];
    this.zone = 1; 
    this.dayPos = 7; 
    this.chanIdx = 0;
    this.progIdx = 0;
    this.progList = [];

    this.onPlayLive = null;
    this.onPlayCatchup = null;
    this.onClose = null;
    this.onToast = null;
    
    this.onProbeCatchup = null;
    
    this._probeChKey = null;

    
    this.el.addEventListener('click', (e) => this._onClick(e));
  }

  _onClick(e) {
    const item = e.target.closest('[data-role]');
    if (!item) return;
    const role = item.dataset.role;
    const idx = parseInt(item.dataset.idx, 10);
    if (role === 'day') {
      this.zone = 0;
      this.dayPos = idx;
      this._loadProg();
      this.render();
    } else if (role === 'chan') {
      this.zone = 1;
      this.chanIdx = idx;
      this._loadProg();
      this.render();
    } else if (role === 'prog') {
      this.zone = 2;
      this.progIdx = idx;
      this._confirm();
    }
  }

  open(channels, currentKey) {
    
    this.channels = channels.filter((c) => c.epgName || c.tvgId);
    if (!this.channels.length) this.channels = channels;
    this.dayPos = 7;
    this.zone = 1;
    let idx = this.channels.findIndex((c) => c.key === currentKey);
    this.chanIdx = idx >= 0 ? idx : 0;
    this.progIdx = 0;
    this._loadProg();
    this._probeChKey = null;
    this.el.classList.remove('hidden');
    this.render();
  }

  _curChannel() {
    return this.channels[this.chanIdx] || null;
  }
  _curOffset() {
    return DAY_OFFSETS[this.dayPos];
  }

  _loadProg() {
    const ch = this._curChannel();
    this.progList = ch ? epgStore.getDayProgrammes(ch, this._curOffset()) : [];
    this.progIdx = 0;
  }

  
  refreshEpg() {
    if (!this.isOpen()) return;
    const focused = this.progList[this.progIdx];
    const ch = this._curChannel();
    this.progList = ch ? epgStore.getDayProgrammes(ch, this._curOffset()) : [];
    const idx = focused ? this.progList.findIndex((p) => p.start === focused.start) : -1;
    const oldIdx = Number.isInteger(this.progIdx) ? this.progIdx : 0;
    this.progIdx = idx >= 0 ? idx : this.progList.length
      ? Math.min(Math.max(0, oldIdx), this.progList.length - 1) : -1;
    this.render();
  }

  render() {
    this._ensureSkeleton();
    this._renderDays();
    this._renderChans();
    this._renderProgs();
    this._renderDetail();
    const f = this.el.querySelector('.focused');
    if (f && f.scrollIntoView) f.scrollIntoView({ block: 'center' });
  }

  
  
  
  
  _ensureSkeleton() {
    
    if (this._skeletonLang === getLang() && this.el.querySelector('#eg-chan-col')) return;
    this.el.innerHTML = `
      <div class="eg-head">
        <div class="eg-title">${t('eg.title')}</div>
        <div class="eg-days" id="eg-day-list"></div>
      </div>
      <div class="eg-body">
        <div class="eg-chan-col" id="eg-chan-col"></div>
        <div class="eg-prog-col" id="eg-prog-col"></div>
      </div>
      <div class="eg-detail" id="eg-detail"></div>`;
    this._skeletonLang = getLang();
    this._chanSig = null; 
    this._chanArr = null;
    this._paintedAct = null;
    this._paintedFoc = null;
  }

  _renderDays() {
    const el = this.el.querySelector('#eg-day-list');
    if (!el) return;
    el.innerHTML = DAY_OFFSETS.map((off, i) => {
      const cls =
        'eg-day' +
        (i === this.dayPos ? ' active' : '') +
        (this.zone === 0 && i === this.dayPos ? ' focused' : '');
      return `<div class="${cls}" data-role="day" data-idx="${i}">${fmtDayLabel(off)}</div>`;
    }).join('');
  }

  
  
  _renderChans() {
    const el = this.el.querySelector('#eg-chan-col');
    if (!el) return;
    const sig = getLang() + '|' + this.channels.length;
    if (sig !== this._chanSig || this.channels !== this._chanArr) {
      this._chanSig = sig;
      this._chanArr = this.channels;
      el.innerHTML = this.channels
        .map(
          (ch, i) =>
            `<div class="eg-chan" data-role="chan" data-idx="${i}">${esc(String(ch.chno || ch.index))}. ${esc(ch.name)}</div>`
        )
        .join('');
      this._paintedAct = null; 
      this._paintedFoc = null;
    }
    
    
    const items = el.children;
    const set = (i, cls, on) => {
      const n = i >= 0 && items[i];
      if (n) n.classList.toggle(cls, on);
    };
    if (this._paintedAct !== this.chanIdx) {
      if (this._paintedAct != null) set(this._paintedAct, 'active', false);
      set(this.chanIdx, 'active', true);
      this._paintedAct = this.chanIdx;
    }
    const foc = this.zone === 1 ? this.chanIdx : -1;
    if (this._paintedFoc !== foc) {
      if (this._paintedFoc != null) set(this._paintedFoc, 'focused', false);
      set(foc, 'focused', true);
      this._paintedFoc = foc;
    }
  }

  _renderProgs() {
    const el = this.el.querySelector('#eg-prog-col');
    if (!el) return;
    const ch = this._curChannel();
    
    
    const chChanged = ch && ch.key !== this._probeChKey;
    this._probeChKey = ch ? ch.key : null;
    if (ch && !ch.catchup && this.onProbeCatchup) {
      this.onProbeCatchup(ch, { recheck: !!chChanged });
    }
    const now = Date.now();
    el.innerHTML = this.progList.length
      ? this.progList
          .map((p, i) => {
            const playing = now >= p.start && now < (isNaN(p.stop) ? p.start + 3600000 : p.stop);
            const canCatchup = isCatchupAvailable(ch, p, ch.catchupDays || 7);
            const cls =
              'eg-prog' +
              (playing ? ' now' : '') +
              (this.zone === 2 && i === this.progIdx ? ' focused' : '');
            const badge = canCatchup ? `<span class="catchup">${t('eg.catchup')}</span>` : '';
            const reminder = isReminder(ch.key, p.start) ? `<span class="reminder">${t('eg.reminderBadge')}</span>` : '';
            return `<div class="${cls}" data-role="prog" data-idx="${i}"><span class="t">${fmtTime(p.start)}-${fmtTime(p.stop)}</span><span class="p">${esc(p.title)}</span>${reminder}${badge}</div>`;
          })
          .join('')
      : `<div class="eg-prog"><span class="p" style="color:#808a94">${t('eg.noEpg')}</span></div>`;
  }

  _renderDetail() {
    const el = this.el.querySelector('#eg-detail');
    if (!el) return;
    const ch = this._curChannel();
    const p = this.progList[this.progIdx];
    if (!ch || !p) {
      el.innerHTML = `<div class="eg-detail-empty">${t('eg.detailsEmpty')}</div>`;
      return;
    }
    const on = isReminder(ch.key, p.start);
    const status = on ? t('eg.reminderOn') : t('eg.reminderOff');
    el.innerHTML = `
      <div class="eg-detail-head">
        <span class="eg-detail-title">${esc(p.title)}</span>
        <span class="eg-detail-time">${fmtDayLabel(this._curOffset())} ${fmtTime(p.start)}-${fmtTime(p.stop)}</span>
        <span class="eg-detail-rem${on ? ' on' : ''}">${status}</span>
      </div>
      <div class="eg-detail-desc">${esc(p.desc || t('eg.noDescription'))}</div>
      <div class="eg-detail-hint">${t('eg.detailsHint')}</div>`;
  }

  _toggleReminder() {
    const ch = this._curChannel();
    const p = this.progList[this.progIdx];
    if (!ch || !p) return;
    const added = toggleReminder(ch.key, p.start, p.title);
    this.render();
    if (this.onToast) {
      this.onToast(added
        ? t('toast.reminderAdded', { title: p.title, time: fmtTime(p.start) })
        : t('toast.reminderRemoved', { title: p.title }));
    }
  }

  handleKey(code) {
    switch (code) {
      case KEY.UP:
        this._move(-1);
        break;
      case KEY.DOWN:
        this._move(1);
        break;
      case KEY.LEFT:
        this._horizontal(-1);
        break;
      case KEY.RIGHT:
        this._horizontal(1);
        break;
      case KEY.OK:
        this._confirm();
        break;
      case KEY.YELLOW:
      case KEY.INFO:
        this._toggleReminder();
        break;
      case KEY.BACK:
        this.close();
        break;
      default:
        return false;
    }
    return true;
  }

  _move(dir) {
    if (this.zone === 0) {
      
      if (dir === 1) { this.zone = 1; this.render(); }
      return;
    }
    if (this.zone === 1) {
      const n = this.channels.length;
      if (!n) return;
      this.chanIdx = (this.chanIdx + dir + n) % n;
      this._loadProg();
    } else if (this.zone === 2) {
      const n = this.progList.length;
      if (!n) return;
      this.progIdx = (this.progIdx + dir + n) % n;
    }
    this.render();
  }

  _horizontal(dir) {
    if (this.zone === 0) {
      const n = DAY_OFFSETS.length;
      this.dayPos = Math.min(n - 1, Math.max(0, this.dayPos + dir));
      this._loadProg();
    } else if (this.zone === 1) {
      if (dir === 1) this.zone = 2; 
      else this.zone = 0; 
    } else if (this.zone === 2) {
      if (dir === -1) this.zone = 1; 
    }
    this.render();
  }

  _confirm() {
    const ch = this._curChannel();
    if (!ch) return;
    if (this.zone === 2) {
      const p = this.progList[this.progIdx];
      if (!p) return;
      const now = Date.now();
      const playing = now >= p.start && now < (isNaN(p.stop) ? p.start + 3600000 : p.stop);
      if (playing) {
        if (this.onPlayLive) { this.onPlayLive(ch); this.close(); }
      } else if (isCatchupAvailable(ch, p, ch.catchupDays || 7)) {
        if (this.onPlayCatchup) { this.onPlayCatchup(ch, p); this.close(); }
      }
    } else {
      
      if (this.onPlayLive) { this.onPlayLive(ch); this.close(); }
    }
  }

  close() {
    this.el.classList.add('hidden');
    if (this.onClose) this.onClose();
  }

  isOpen() {
    return !this.el.classList.contains('hidden');
  }
}
