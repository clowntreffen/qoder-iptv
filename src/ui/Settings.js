
import { KEY } from '../core/keys.js';
import { getSettings, saveSettings, clearEpgCache, clearCatchupProbe } from '../core/storage.js';
import { t } from '../core/i18n.js';
import { esc } from '../core/util.js';
import { THEMES, themeName } from '../core/themes.js';

const ASPECTS = ['16:9', '4:3', 'fill'];
const DECODERS = ['auto', 'native', 'hls'];
const FONT_SCALES = [0.8, 0.9, 1, 1.1, 1.2, 1.3];
const SLEEPS = [0, 15, 30, 60, 90, 120];

const aspectLabel = (v) => (v === 'fill' ? t('label.fill') : v);
const decoderLabel = (v) => (v === 'auto' ? t('label.auto') : v === 'native' ? t('label.native') : 'hls.js');
const fontLabel = (v) => `${Math.round((Number(v) || 1) * 100)}%`;
const sleepLabel = (v) => (v > 0 ? t('label.minutes', { n: v }) : t('label.off'));

export class Settings {
  constructor(el) {
    this.el = el;
    this.focusIdx = 0;
    this.s = getSettings();

    this.onChange = null; // (settings) => void
    this.onRefreshEpg = null;
    this.onOpenSources = null;
    this.onOpenGroups = null;
    this.onOpenGroupLocks = null;
    this.onOpenTuning = null;
    this.onOpenDevice = null;
    this.onCycleAudio = null;
    this.onCycleSubtitle = null;
    this.getTrackLabels = null;
    this.onSetPin = null;
    this.onClearPin = null;
    this.onBackup = null;
    this.onRestore = null;
    this.onClose = null;

    
    this.el.addEventListener('click', (e) => this._onClick(e));
  }

  _onClick(e) {
    
    if (!e.target.closest('.panel')) {
      this.close();
      return;
    }
    const hit = e.target.closest('[data-role]');
    if (!hit) return;
    const role = hit.dataset.role;
    if (role === 'close') {
      this.close();
      return;
    }
    const rowEl = hit.closest('[data-idx]');
    const idx = rowEl ? parseInt(rowEl.dataset.idx, 10) : NaN;
    if (isNaN(idx)) return;
    this.focusIdx = idx;
    this.render(); 
    if (role === 'dec') this._cycle(-1);
    else if (role === 'inc') this._cycle(1);
    else this._confirm(); 
  }

  
  _rows() {
    const tracks = this.getTrackLabels ? this.getTrackLabels() : {};
    const rows = [
      { key: 'aspect', type: 'select', label: t('settings.aspect'), value: aspectLabel(this.s.aspect) },
      { key: 'decoder', type: 'select', label: t('settings.decoder'), value: decoderLabel(this.s.decoder) },
      { key: 'debug', type: 'select', label: t('settings.debug'), value: this.s.debugOverlay ? t('label.on') : t('label.off') },
      { key: 'autoPlay', type: 'select', label: t('settings.autoPlay'), value: this.s.autoPlayLast ? t('label.on') : t('label.off') },
      { key: 'netSpeed', type: 'select', label: t('settings.netSpeed'), value: this.s.showNetSpeed ? t('label.on') : t('label.off') },
      { key: 'fontScale', type: 'select', label: t('settings.fontScale'), value: fontLabel(this.s.fontScale) },
      { key: 'theme', type: 'select', label: t('settings.theme'), value: themeName(this.s.theme) },
      { key: 'audio', type: 'select', label: t('settings.audio'), value: tracks.audio || t('label.auto') },
      { key: 'subtitles', type: 'select', label: t('settings.subtitles'), value: tracks.subtitles || t('label.off') },
      { key: 'sleep', type: 'select', label: t('settings.sleep'), value: sleepLabel(this.s.sleepMinutes) },
      { key: 'autoRefresh', type: 'select', label: t('settings.autoRefresh'), value: this.s.autoRefresh ? t('label.on') : t('label.off') },
      { key: 'refreshSources', type: 'button', label: t('settings.refreshSources') },
      { key: 'refreshEpg', type: 'button', label: t('settings.refreshEpg') },
      { key: 'clearEpg', type: 'button', label: t('settings.clearEpg') },
      { key: 'groups', type: 'button', label: t('settings.groupManager') },
      { key: 'groupLocks', type: 'button', label: t('settings.groupLocks') },
      { key: 'sources', type: 'button', label: t('settings.sourceManager') },
      { key: 'tuning', type: 'button', label: t('settings.playerTuning') },
      { key: 'device', type: 'button', label: t('settings.deviceInfo') },
      { key: 'pin', type: 'button', label: this.s.parentalPin ? t('settings.changePin') : t('settings.setPin') },
      { key: 'backup', type: 'button', label: t('settings.backup') },
      { key: 'restore', type: 'button', label: t('settings.restore') }
    ];
    if (this.s.parentalPin) {
      rows.splice(-2, 0,
        { key: 'appLock', type: 'select', label: t('settings.appLock'), value: this.s.appLock ? t('label.on') : t('label.off') },
        { key: 'clearPin', type: 'button', label: t('settings.clearPin') }
      );
    }
    return rows;
  }

  open() {
    this.s = getSettings();
    this.focusIdx = 0;
    this.el.classList.remove('hidden');
    this.render();
  }

  render() {
    const rows = this._rows();
    const html = rows
      .map((r, i) => {
        const cls = 'form-row' + (i === this.focusIdx ? ' focused' : '');
        const val =
          r.type === 'select'
            ? `<span class="value"><b class="arrow" data-role="dec">◄</b>${esc(r.value)}<b class="arrow" data-role="inc">►</b></span>`
            : '';
        return `<div class="${cls}" data-role="row" data-idx="${i}"><span class="label">${r.label}</span>${val}</div>`;
      })
      .join('');
    this.el.innerHTML = `
      <div class="panel">
        <div class="panel-close" data-role="close">✕</div>
        <h2>${t('settings.title')}</h2>
        <div class="src-list">${html}</div>
        <div class="hint">${t('settings.hint')}</div>
      </div>
    `;
    
    const focused = this.el.querySelector('.focused');
    if (focused && focused.scrollIntoView) focused.scrollIntoView({ block: 'center' });
  }

  _cycle(dir) {
    const cyc = (arr, cur) => {
      const i = arr.indexOf(cur);
      return arr[(i + dir + arr.length) % arr.length];
    };
    const row = this._rows()[this.focusIdx];
    if (!row || row.type !== 'select') return;
    switch (row.key) {
      case 'aspect':
        this.s.aspect = cyc(ASPECTS, this.s.aspect);
        break;
      case 'decoder':
        this.s.decoder = cyc(DECODERS, this.s.decoder);
        break;
      case 'debug':
        this.s.debugOverlay = !this.s.debugOverlay;
        break;
      case 'autoPlay':
        this.s.autoPlayLast = !this.s.autoPlayLast;
        break;
      case 'netSpeed':
        this.s.showNetSpeed = !this.s.showNetSpeed;
        break;
      case 'fontScale':
        this.s.fontScale = cyc(FONT_SCALES, this.s.fontScale);
        break;
      case 'theme':
        this.s.theme = cyc(THEMES.map((theme) => theme.id), this.s.theme);
        break;
      case 'audio':
        if (this.onCycleAudio) this.onCycleAudio(dir);
        this.render();
        return;
      case 'subtitles':
        if (this.onCycleSubtitle) this.onCycleSubtitle(dir);
        this.render();
        return;
      case 'sleep':
        this.s.sleepMinutes = cyc(SLEEPS, this.s.sleepMinutes || 0);
        break;
      case 'autoRefresh':
        this.s.autoRefresh = !this.s.autoRefresh;
        break;
      case 'appLock':
        this.s.appLock = !this.s.appLock;
        break;
      default:
        return;
    }
    saveSettings(this.s);
    if (this.onChange) this.onChange(this.s);
    this.render();
  }

  _confirm() {
    const row = this._rows()[this.focusIdx];
    if (!row) return;
    switch (row.key) {
      case 'refreshSources':
        if (this.onRefreshSources) this.onRefreshSources();
        break;
      case 'refreshEpg':
        if (this.onRefreshEpg) this.onRefreshEpg();
        break;
      case 'clearEpg':
        clearEpgCache();
        clearCatchupProbe();
        if (this.onRefreshEpg) this.onRefreshEpg();
        break;
      case 'groups':
        this.close();
        if (this.onOpenGroups) this.onOpenGroups();
        break;
      case 'groupLocks':
        this.close();
        if (this.onOpenGroupLocks) this.onOpenGroupLocks();
        break;
      case 'sources':
        this.close();
        if (this.onOpenSources) this.onOpenSources();
        break;
      case 'tuning':
        this.close();
        if (this.onOpenTuning) this.onOpenTuning();
        break;
      case 'device':
        this.close();
        if (this.onOpenDevice) this.onOpenDevice();
        break;
      case 'pin':
        if (this.onSetPin) this.onSetPin();
        break;
      case 'clearPin':
        if (this.onClearPin) this.onClearPin();
        this.s = getSettings();
        this.render();
        break;
      case 'backup':
        if (this.onBackup) this.onBackup();
        break;
      case 'restore':
        if (this.onRestore) this.onRestore();
        break;
      default:
        this._cycle(1); 
    }
  }

  handleKey(code) {
    switch (code) {
      case KEY.UP:
        this.focusIdx = Math.max(0, this.focusIdx - 1);
        this.render();
        break;
      case KEY.DOWN:
        this.focusIdx = Math.min(this._rows().length - 1, this.focusIdx + 1);
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
    this.el.classList.add('hidden');
    if (this.onClose) this.onClose();
  }

  isOpen() {
    return !this.el.classList.contains('hidden');
  }
}
