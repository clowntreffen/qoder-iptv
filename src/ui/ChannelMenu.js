
import { KEY } from '../core/keys.js';
import { epgStore } from '../core/epgStore.js';
import { isCatchupAvailable } from '../core/catchup.js';
import { isFavorite, favVersion, toggleFavorite, getRecents } from '../core/storage.js';
import { fmtTime, fmtDayLabel, esc, logoHtml, isLogoFailed, markLogoFailed } from '../core/util.js';
import { t, getLang, groupLabel } from '../core/i18n.js';


const DAY_OFFSETS = [];
for (let i = -7; i <= 4; i++) DAY_OFFSETS.push(i);
const TODAY_POS = DAY_OFFSETS.indexOf(0);



const CHAN_ROW_H = 100;
const CHAN_OVERSCAN = 5;


const GROUP_MARQUEE_SPEED = 80;
const GROUP_MARQUEE_HOLD = 1200;


const COL_GROUP = 0;
const COL_CHAN = 1;
const COL_DATE = 2;
const COL_EPG = 3;

export class ChannelMenu {
  constructor(el) {
    this.el = el;
    this.channels = [];
    this.groups = []; // [{ name, channels }]
    this.col = COL_CHAN;
    this.groupIdx = 0;
    this.chanIdx = 0;
    this.dayPos = TODAY_POS;
    this.epgIdx = 0;
    this.epgList = [];
    this.currentKey = null;
    this.settingsFocused = false; 
    
    this._winStart = 0;
    this._winEnd = 0;
    this._scrollRaf = 0;

    this.onPlayLive = null;
    this.onPlayCatchup = null;
    this.onOpenSettings = null;
    this.onOpenSearch = null;
    this.onEditChannel = null; 
    this.onClose = null;
    this.onToast = null;
    
    this.onRequestUnlock = null;
    this.isGroupUnlocked = () => true;
    
    this.onProbeCatchup = null;
    this.catchupNote = null;
    
    this._epgShown = false;
    this._probeChKey = null;

    
    this.el.addEventListener('click', (e) => this._onClick(e));
  }

  _onClick(e) {
    const item = e.target.closest('[data-role]');
    if (!item) {
      
      if (this.col !== COL_DATE && this.col !== COL_EPG && !e.target.closest('.cm-col:not(.hidden)')) {
        this.close();
      }
      return;
    }
    const role = item.dataset.role;
    const idx = parseInt(item.dataset.idx, 10);
    if (role !== 'settings') this.settingsFocused = false;
    if (role === 'group') {
      this._enterGroup(idx);
    } else if (role === 'fav') {
      this.col = COL_CHAN;
      this.chanIdx = idx;
      this._toggleFav();
    } else if (role === 'chan') {
      this.col = COL_CHAN;
      this.chanIdx = idx;
      this._confirm();
    } else if (role === 'expand') {
      
      this.chanIdx = idx;
      this.col = COL_DATE;
      this.dayPos = TODAY_POS;
      this._loadEpg();
      this.render();
    } else if (role === 'day') {
      this.col = COL_DATE;
      this.dayPos = idx;
      this._loadEpg();
      this.render();
    } else if (role === 'epg') {
      this.col = COL_EPG;
      this.epgIdx = idx;
      this._confirm();
    } else if (role === 'settings') {
      this._openSettings();
    }
  }

  _openSettings() {
    if (this.onOpenSettings) {
      this.close();
      this.onOpenSettings();
    }
  }

  _buildGroups() {
    const favChannels = this.channels.filter((c) => isFavorite(c.key));
    const byKey = new Map(this.channels.map((ch) => [ch.key, ch]));
    const recentChannels = getRecents().map((key) => byKey.get(key)).filter(Boolean);
    const map = new Map();
    for (const ch of this.channels) {
      if (!map.has(ch.group)) map.set(ch.group, []);
      map.get(ch.group).push(ch);
    }
    const groups = [{ name: t('cm.favGroup'), channels: favChannels, fav: true }];
    if (recentChannels.length) {
      groups.push({ name: t('cm.recentGroup'), channels: recentChannels, recent: true });
    }
    for (const [name, list] of map.entries()) {
      groups.push({ name, channels: list, locked: !this.isGroupUnlocked(name) });
    }
    this.groups = groups;
  }

  open(channels, currentKey) {
    this.channels = channels;
    this.currentKey = currentKey;
    this._buildGroups();

    
    let g = 0, c = 0, found = false;
    for (let pass = 0; pass < 2 && !found; pass++) {
      for (let gi = 0; gi < this.groups.length; gi++) {
        const grp = this.groups[gi];
        const virtual = !!(grp.fav || grp.recent);
        
        if ((pass === 0) === virtual) continue;
        const idx = grp.channels.findIndex((ch) => ch.key === currentKey);
        if (idx >= 0) { g = gi; c = idx; found = true; break; }
      }
    }
    this.groupIdx = g;
    this.chanIdx = c;
    this.dayPos = TODAY_POS;
    this.col = COL_CHAN;
    this.settingsFocused = false;
    this._loadEpg();
    this.el.classList.remove('hidden');
    this.render();
  }

  _curGroup() {
    return this.groups[this.groupIdx] || { name: '', channels: [] };
  }
  _curChannel() {
    return this._curGroup().channels[this.chanIdx] || null;
  }
  _curOffset() {
    return DAY_OFFSETS[this.dayPos];
  }

  
  _zapMode() {
    return this._curGroup().fav ? 'fav' : 'all';
  }

  _loadEpg() {
    const ch = this._curChannel();
    const off = this._curOffset();
    this.epgList = ch ? epgStore.getDayProgrammes(ch, off) : [];
    
    let idx = 0;
    if (off === 0) {
      const now = Date.now();
      const f = this.epgList.findIndex(
        (p) => now >= p.start && now < (isNaN(p.stop) ? p.start + 3600000 : p.stop)
      );
      if (f >= 0) idx = f;
    }
    this.epgIdx = idx;
  }

  render() {
    this._ensureSkeleton();
    this._renderGroups();
    this._renderChannels();
    this._renderDateEpg();
    this._scrollToFocused();
  }

  
  
  _ensureSkeleton() {
    
    if (this._skeletonLang === getLang() && this.el.querySelector('#cm-chan-list')) return;
    this.el.innerHTML = `
      <div class="cm-col cm-groups">
        <div class="cm-title">${t('cm.group')}</div>
        <div class="cm-list" id="cm-group-list"></div>
        <div class="cm-favhint">${t('cm.favHint')}</div>
        <div class="cm-settings" id="cm-settings" data-role="settings"><span class="ico">⚙</span><span>${t('cm.settings')}</span></div>
      </div>
      <div class="cm-col cm-channels">
        <div class="cm-title" id="cm-chan-title"></div>
        <div class="cm-list" id="cm-chan-list"></div>
      </div>
      <div class="cm-col cm-dates hidden" id="cm-dates-col">
        <div class="cm-title">${t('cm.date')}</div>
        <div class="cm-list" id="cm-date-list"></div>
      </div>
      <div class="cm-col cm-epg hidden" id="cm-epg-col">
        <div class="cm-title" id="cm-epg-title"></div>
        <div class="cm-list" id="cm-epg-list"></div>
      </div>`;
    this._skeletonLang = getLang();
    this._groupHtml = null;
    this._chanSig = null; 
    this._chanArr = null;
    this._paintedFoc = null;
    this._winStart = 0;
    this._winEnd = 0;
    
    const chanList = this.el.querySelector('#cm-chan-list');
    chanList.addEventListener('scroll', () => this._onChanScroll(), { passive: true });
    
    chanList.addEventListener('error', (e) => {
      const img = e.target;
      if (!img || img.tagName !== 'IMG') return;
      markLogoFailed(img.getAttribute('src'));
      this._applyLogoColumn();
    }, true);
  }

  _renderGroups() {
    const listEl = this.el.querySelector('#cm-group-list');
    if (listEl) {
      const html = this.groups
        .map((grp, i) => {
          const cls =
            'cm-group-item' +
            (i === this.groupIdx ? ' active' : '') +
            (this.col === COL_GROUP && !this.settingsFocused && i === this.groupIdx ? ' focused' : '');
          const lock = grp.locked ? `<span class="lock">${esc(t('gm.lockedBadge'))}</span>` : '';
          return `<div class="${cls}" data-role="group" data-idx="${i}"><span class="cm-gname"><span>${esc(groupLabel(grp.name))}</span></span>${lock}<span class="badge">${grp.channels.length}</span></div>`;
        })
        .join('');
      
      if (html !== this._groupHtml) {
        this._groupHtml = html;
        listEl.innerHTML = html;
        this._marqueeGroup(listEl);
      }
    }
    const setEl = this.el.querySelector('#cm-settings');
    if (setEl) setEl.classList.toggle('focused', this.col === COL_GROUP && this.settingsFocused);
  }

  _marqueeGroup(listEl) {
    const box = listEl.querySelector('.cm-group-item.focused .cm-gname');
    const text = box && box.firstElementChild;
    if (!text || !text.animate) return;
    const over = box.scrollWidth - box.clientWidth;
    if (over <= 2) return;
    box.classList.add('marquee');
    const total = GROUP_MARQUEE_HOLD * 2 + (over / GROUP_MARQUEE_SPEED) * 1000;
    const hold = GROUP_MARQUEE_HOLD / total;
    const end = 'translateX(' + -over + 'px)';
    text.animate([
      { transform: 'translateX(0)', offset: 0 },
      { transform: 'translateX(0)', offset: hold },
      { transform: end, offset: 1 - hold },
      { transform: end, offset: 1 }
    ], { duration: total, iterations: Infinity });
  }

  
  
  _renderChannels() {
    const grp = this._curGroup();
    const chans = grp.channels;
    const titleEl = this.el.querySelector('#cm-chan-title');
    if (titleEl) {
      titleEl.textContent = grp.name
        ? t('cm.groupChannels', { n: chans.length, g: groupLabel(grp.name) })
        : t('cm.channels', { n: chans.length });
    }
    const listEl = this.el.querySelector('#cm-chan-list');
    if (!listEl) return;

    if (grp.fav && !chans.length) {
      this._chanSig = 'fav-empty|' + getLang();
      this._chanArr = chans;
      this._paintedFoc = null;
      this._winStart = 0;
      this._winEnd = 0;
      listEl.style.setProperty('--sp-top', '0px');
      listEl.style.setProperty('--sp-bottom', '0px');
      listEl.classList.remove('no-logo');
      listEl.innerHTML = `<div class="cm-empty">${t('cm.favEmpty')}</div>`;
      return;
    }

    const sig = this._channelsSig(chans);
    
    
    const newList = chans !== this._chanArr;
    if (sig !== this._chanSig || newList) {
      this._chanSig = sig;
      this._chanArr = chans;
      if (newList) {
        
        
        
        this._winStart = Math.max(0, this.chanIdx - Math.floor(this._chanPer(listEl) / 2));
      }
      this._paintChanWindow(listEl); 
      if (newList) listEl.scrollTop = this._winStart * CHAN_ROW_H;
    } else {
      this._ensureChanWindow(listEl); 
      this._updateChanFocus(listEl); 
    }
    this._applyLogoColumn();
  }

  
  
  _applyLogoColumn() {
    const listEl = this.el.querySelector('#cm-chan-list');
    const chans = this._chanArr;
    if (!listEl || !chans) return;
    const shown = chans
      .slice(this._winStart, this._winEnd)
      .some((c) => c.logo && !isLogoFailed(c.logo));
    listEl.classList.toggle('no-logo', !shown);
  }

  
  _chanPer(listEl) {
    return Math.max(1, Math.ceil(listEl.clientHeight / CHAN_ROW_H));
  }

  
  
  
  _paintChanWindow(listEl) {
    const chans = this._chanArr;
    const total = chans.length;
    const s = Math.max(0, Math.min(this._winStart, Math.max(0, total - 1)));
    const e = Math.min(total, s + this._chanPer(listEl) + CHAN_OVERSCAN * 2);
    listEl.style.setProperty('--sp-top', s * CHAN_ROW_H + 'px');
    listEl.style.setProperty('--sp-bottom', (total - e) * CHAN_ROW_H + 'px');
    listEl.innerHTML = chans.slice(s, e).map((ch, i) => this._channelItemHtml(ch, s + i)).join('');
    this._winStart = s;
    this._winEnd = e;
    this._paintedFoc = this.col === COL_CHAN ? this.chanIdx : -1;
  }

  
  _ensureChanWindow(listEl) {
    const total = this._chanArr ? this._chanArr.length : 0;
    if (!total || this.col !== COL_CHAN) return;
    const per = this._chanPer(listEl);
    const i = this.chanIdx;
    if (i >= this._winStart && i < this._winStart + per) return; 
    this._winStart = Math.max(0, Math.min(i - Math.floor(per / 2), total - 1));
    listEl.scrollTop = this._winStart * CHAN_ROW_H;
    this._paintChanWindow(listEl);
  }

  
  _onChanScroll() {
    if (this._scrollRaf) return;
    this._scrollRaf = requestAnimationFrame(() => {
      this._scrollRaf = null;
      this._syncChanWindow();
    });
  }

  _syncChanWindow() {
    const listEl = this.el.querySelector('#cm-chan-list');
    if (!listEl || !this._chanArr || !this._chanArr.length) return;
    let s = Math.round(listEl.scrollTop / CHAN_ROW_H) - CHAN_OVERSCAN;
    s = Math.max(0, Math.min(s, this._chanArr.length - 1));
    if (s !== this._winStart) {
      this._winStart = s;
      this._paintChanWindow(listEl);
    }
  }

  
  //
  
  
  
  
  //
  
  
  
  _channelsSig(chans) {
    return (
      getLang() +
      '|' +
      (this.currentKey || '') +
      '|' +
      favVersion() +
      '|' +
      epgStore.version +
      '|' +
      chans.length
    );
  }

  _channelItemHtml(ch, i) {
    const nn = epgStore.getNowNext(ch);
    const nowTitle = nn.now ? nn.now.title : '';
    const favOn = isFavorite(ch.key);
    const fav = `<span class="fav${favOn ? ' on' : ''}" data-role="fav" data-idx="${i}" title="${esc(t('cm.favToggle'))}">${favOn ? '★' : '☆'}</span>`;
    const multi = ch.sources && ch.sources.length > 1
      ? `<span class="src-badge">${t('cm.srcBadge', { n: ch.sources.length })}</span>` : '';
    const hiddenMark = ch.customHidden ? `<span class="hidden-badge">${esc(t('ce.hiddenOn'))}</span>` : '';
    const cls =
      'cm-channel-item' +
      (ch.customHidden ? ' hidden-entry' : '') +
      (ch.key === this.currentKey ? ' playing' : '') +
      (this.col === COL_CHAN && i === this.chanIdx ? ' focused' : '');
    
    
    return `
          <div class="${cls}" data-role="chan" data-idx="${i}">
            <div class="num">${esc(String(ch.chno || ch.index))}</div>
            <div class="logo">${logoHtml(ch)}</div>
            <div class="meta">
              <div class="name">${fav} ${esc(ch.name)} ${multi}${hiddenMark}</div>
              <div class="now">${esc(nowTitle)}</div>
            </div>
            <div class="cm-chan-hint" data-role="expand" data-idx="${i}">${t('cm.channelHint')}</div>
          </div>`;
  }

  
  
  
  _updateChanFocus(listEl) {
    const foc = this.col === COL_CHAN ? this.chanIdx : -1;
    if (this._paintedFoc === foc) return;
    const childOf = (abs) =>
      abs >= this._winStart && abs < this._winEnd ? listEl.children[abs - this._winStart] : null;
    if (this._paintedFoc != null) {
      const old = childOf(this._paintedFoc);
      if (old) old.classList.remove('focused');
    }
    if (foc >= 0) {
      const neu = childOf(foc);
      if (neu) neu.classList.add('focused');
    }
    this._paintedFoc = foc;
  }

  
  _renderDateEpg() {
    const show = this.col === COL_DATE || this.col === COL_EPG;
    const reopen = show && !this._epgShown;
    this._epgShown = show;
    const datesCol = this.el.querySelector('#cm-dates-col');
    const epgCol = this.el.querySelector('#cm-epg-col');
    if (datesCol) datesCol.classList.toggle('hidden', !show);
    if (epgCol) epgCol.classList.toggle('hidden', !show);
    if (!show) return;

    const dateListEl = this.el.querySelector('#cm-date-list');
    if (dateListEl) {
      dateListEl.innerHTML = DAY_OFFSETS.map((off, i) => {
        const cls =
          'cm-date-item' +
          (i === this.dayPos ? ' active' : '') +
          (this.col === COL_DATE && i === this.dayPos ? ' focused' : '');
        return `<div class="${cls}" data-role="day" data-idx="${i}">${fmtDayLabel(off)}</div>`;
      }).join('');
    }

    const ch = this._curChannel();
    
    
    const chChanged = ch && ch.key !== this._probeChKey;
    this._probeChKey = ch ? ch.key : null;
    if (ch && !ch.catchup && this.onProbeCatchup) {
      this.onProbeCatchup(ch, { recheck: !!(reopen || chChanged) });
    }
    const titleEl = this.el.querySelector('#cm-epg-title');
    if (titleEl) {
      const note = ch && this.catchupNote ? this.catchupNote(ch) : '';
      titleEl.innerHTML = ch
        ? esc(ch.name) + ' · ' + fmtDayLabel(this._curOffset()) +
          (note ? `<span class="cm-cu-note">${esc(note)}</span>` : '')
        : t('cm.epg');
    }
    const epgListEl = this.el.querySelector('#cm-epg-list');
    if (!epgListEl) return;
    const now = Date.now();
    epgListEl.innerHTML = this.epgList.length
      ? this.epgList
          .map((p, i) => {
            const playing = now >= p.start && now < (isNaN(p.stop) ? p.start + 3600000 : p.stop);
            const canCatchup = isCatchupAvailable(ch, p, ch.catchupDays || 7);
            const cls =
              'cm-epg-item' +
              (playing ? ' now' : '') +
              (this.col === COL_EPG && i === this.epgIdx ? ' focused' : '');
            const badge = canCatchup ? `<span class="catchup">${t('cm.catchup')}</span>` : '';
            return `<div class="${cls}" data-role="epg" data-idx="${i}"><span class="t">${fmtTime(p.start)}</span><span class="p">${esc(p.title)}</span>${badge}</div>`;
          })
          .join('')
      : `<div class="cm-epg-item"><span class="p" style="color:#808a94">${t('cm.noEpg')}</span></div>`;
  }

  _scrollToFocused() {
    
    
    const chanList = this.el.querySelector('#cm-chan-list');
    if (chanList && this.col === COL_CHAN && this._chanArr) {
      const top = this.chanIdx * CHAN_ROW_H;
      const cur = chanList.scrollTop;
      if (top < cur) chanList.scrollTop = top;
      else if (top + CHAN_ROW_H > cur + chanList.clientHeight) {
        chanList.scrollTop = top + CHAN_ROW_H - chanList.clientHeight;
      }
    }
    
    const focused = this.el.querySelector('.focused:not(.cm-channel-item)');
    if (focused && focused.scrollIntoView) {
      focused.scrollIntoView({ block: 'center' });
    }
  }

  
  
  refreshEpg() {
    if (!this.isOpen()) return;
    const ch = this._curChannel();
    const off = this._curOffset();
    this.epgList = ch ? epgStore.getDayProgrammes(ch, off) : [];
    if (this.epgIdx >= this.epgList.length) this.epgIdx = Math.max(0, this.epgList.length - 1);
    this.render();
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
        this._switchCol(-1);
        break;
      case KEY.RIGHT:
        this._switchCol(1);
        break;
      case KEY.OK:
        this._confirm();
        break;
      case KEY.MENU:
        this._editChannel();
        break;
      case KEY.INFO:
      case KEY.YELLOW:
        this._toggleFav();
        break;
      case KEY.BLUE:
        if (this.onOpenSearch) {
          const ch = this._curChannel();
          this.close();
          this.onOpenSearch(ch && ch.key);
        }
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
    if (this.col === COL_GROUP) {
      
      if (this.settingsFocused) { this.settingsFocused = false; this.render(); return; }
      const n = this.groups.length;
      this.groupIdx = (this.groupIdx + dir + n) % n;
      this.chanIdx = 0;
      this._loadEpg();
    } else if (this.col === COL_CHAN) {
      const n = this._curGroup().channels.length;
      if (!n) return;
      this.chanIdx = (this.chanIdx + dir + n) % n;
      this._loadEpg();
    } else if (this.col === COL_DATE) {
      const n = DAY_OFFSETS.length;
      this.dayPos = Math.min(n - 1, Math.max(0, this.dayPos + dir));
      this._loadEpg();
    } else if (this.col === COL_EPG) {
      const n = this.epgList.length;
      if (!n) return;
      this.epgIdx = (this.epgIdx + dir + n) % n;
    }
    this.render();
  }

  _switchCol(dir) {
    if (this.col === COL_GROUP) {
      
      if (dir < 0) {
        if (!this.settingsFocused) { this.settingsFocused = true; this.render(); }
        return;
      }
      
      if (this.settingsFocused) { this.settingsFocused = false; this.render(); return; }
      
      this._enterGroup(this.groupIdx);
      return;
    }
    const next = this.col + dir;
    if (next < COL_GROUP || next > COL_EPG) return;
    if (next === COL_EPG && !this.epgList.length) return;
    this.col = next;
    
    if (next === COL_DATE) this._loadEpg();
    this.render();
  }

  
  _editChannel() {
    if (this.col !== COL_CHAN) return;
    const ch = this._curChannel();
    if (!ch || !this.onEditChannel) return;
    this.onEditChannel(ch);
  }

  
  _toggleFav() {
    const ch = this._curChannel();
    if (!ch) return;
    const wasFav = isFavorite(ch.key);
    toggleFavorite(ch.key);
    this._buildGroups();
    if (wasFav) {
      
      const gi = this.groups.findIndex((g) => g.channels.some((c) => c.key === ch.key));
      if (gi >= 0) {
        this.groupIdx = gi;
        this.chanIdx = this.groups[gi].channels.findIndex((c) => c.key === ch.key);
      } else {
        this.chanIdx = 0;
      }
    } else {
      const grp = this._curGroup();
      this.chanIdx = Math.min(this.chanIdx, Math.max(0, grp.channels.length - 1));
    }
    this._loadEpg();
    this.render();
    if (this.onToast) {
      this.onToast(wasFav ? t('toast.unfaved') : t('toast.faved', { name: ch.name }));
    }
  }

  
  _enterGroup(idx) {
    const grp = this.groups[idx];
    if (!grp) return;
    const enter = () => {
      this.groupIdx = idx;
      this.chanIdx = 0;
      this.col = COL_CHAN;
      this._loadEpg();
      this.render();
    };
    if (grp.fav || grp.recent || !grp.locked || !this.onRequestUnlock) { enter(); return; }
    this.onRequestUnlock(grp.name, (ok) => { if (ok) enter(); });
  }

  _confirm() {
    if (this.col === COL_GROUP) {
      
      if (this.settingsFocused) {
        this._openSettings();
        return;
      }
      
      this._enterGroup(this.groupIdx);
    } else if (this.col === COL_CHAN) {
      
      const ch = this._curChannel();
      if (ch && this.onPlayLive) {
        this.currentKey = ch.key;
        this.onPlayLive(ch, { zapMode: this._zapMode() });
        this.close();
      }
    } else if (this.col === COL_DATE) {
      
      if (this.epgList.length) {
        this.col = COL_EPG;
        this.render();
      }
    } else if (this.col === COL_EPG) {
      const ch = this._curChannel();
      const p = this.epgList[this.epgIdx];
      if (!ch || !p) return;
      const now = Date.now();
      const playing = now >= p.start && now < (isNaN(p.stop) ? p.start + 3600000 : p.stop);
      if (playing) {
        if (this.onPlayLive) {
          this.onPlayLive(ch, { zapMode: this._zapMode() });
          this.close();
        }
      } else if (isCatchupAvailable(ch, p, ch.catchupDays || 7)) {
        if (this.onPlayCatchup) { this.onPlayCatchup(ch, p); this.close(); }
      }
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
