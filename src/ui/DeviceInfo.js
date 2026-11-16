
//


import { KEY } from '../core/keys.js';
import Hls from 'hls.js';
import { collectDevice, probeMseHevcLevels } from '../core/deviceInfo.js';
import { esc } from '../core/util.js';
import { t } from '../core/i18n.js';



function explainErr(err) {
  if (!err) return '';
  if (err === 'no-bridge') return t('di.err.noBridge');
  if (err === 'timeout') return t('di.err.timeout');
  if (err === 'bad-json') return t('di.err.badJson');
  if (err === 'call-throw') return t('di.err.callThrow');
  if (/Unknown method/i.test(err)) return t('di.err.unknownMethod');
  if (/Denied/i.test(err)) return t('di.err.denied');
  if (/not handled/i.test(err)) return t('di.err.notHandled');
  return err;
}

export class DeviceInfo {
  constructor(el, player) {
    this.el = el;
    this.player = player;
    this.info = null;
    this.loading = false;
    
    this.showRaw = false;
    this.focus = 0; 
    this.scrollTop = 0; 
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
    if (hit.dataset.role === 'close') this.close();
    else if (hit.dataset.role === 'again') this._load();
    else if (hit.dataset.role === 'raw') {
      this.showRaw = !this.showRaw;
      this.render();
    }
  }

  open() {
    this.el.classList.remove('hidden');
    this.focus = 0;
    this.scrollTop = 0;
    this._load();
  }

  
  
  _scroll(dy) {
    const b = this.el.querySelector('.di-body');
    if (!b) return;
    b.scrollTop += dy;
    this.scrollTop = b.scrollTop;
  }

  async _load() {
    if (this.loading) return;
    this.loading = true;
    this.render();
    try {
      this.info = await collectDevice();
    } catch (e) {
      this.info = null;
    }
    this.loading = false;
    this.render();
  }

  
  
  _rawBlock() {
    const ps = (this.info && this.info.probes) || [];
    if (!ps.length) return `<div class="hint">${t('di.noProbes')}</div>`;
    
    
    return (
      `<div style="margin-top:14px">` +
      ps
        .map((p) => {
          const head = p.ok
            ? `<span style="color:#4fd08a">OK</span>`
            : `<span style="color:#e2725b">FAIL</span> ${esc(explainErr(p.err))}`;
          const txt = p.text
            ? `<div style="font-size:18px;color:#8b95a3;word-break:break-all;line-height:1.4;margin-top:2px">${esc(p.text)}</div>`
            : '';
          return `<div style="margin-bottom:12px">
                    <div style="font-size:21px;color:#c9d3e0">${esc(p.name)} · ${head}</div>
                    ${txt}
                  </div>`;
        })
        .join('') +
      `</div>`
    );
  }

  
  
  
  _mediaRows(row) {
    const caps = probeMseHevcLevels();
    const hit = caps.filter((c) => c.mime)[0];
    const capsText = caps.map((c) => c.tag + (c.mime ? ' ✓' : ' ✗')).join(' · ');
    const p = this.player;
    const mi = (p && p.mediaInfo) || {};
    const path = p && typeof p.activePath === 'function' ? p.activePath() : '';
    const raw = mi.videoCodec || '';
    const kind = /hvc1|hev1|hevc/i.test(raw) ? 'HEVC'
      : /avc1|avc|h264/i.test(raw) ? 'H.264' : raw;
    const size = mi.width && mi.height ? ' · ' + mi.width + '×' + mi.height : '';
    const pathText = path === 'hls' ? t('di.pathHls') : path === 'native' ? t('di.pathNative') : '';
    const note = [pathText, raw && raw !== kind ? raw : ''].filter(Boolean).join(' · ');
    return (
      row(t('di.hevcCaps'), esc(capsText), esc(hit ? hit.mime : '')) +
      row(t('di.curCodec'), esc(kind ? kind + size : t('di.noChannel')), esc(note))
    );
  }

  render() {
    const d = this.info;
    const row = (label, value, note) =>
      `<div class="form-row"><span class="label">${label}</span>` +
      `<span class="value">${value}${note ? ' <i style="color:#7d8794;font-style:normal">' + note + '</i>' : ''}</span></div>`;

    let body;
    if (this.loading || !d) {
      body = `<div class="hint">${this.loading ? t('di.detecting') : t('di.failed')}</div>`;
    } else {
      const btn = (i, role, text) =>
        `<div class="btn${this.focus === i ? ' focused' : ''}" data-role="${role}">${text}</div>`;
      body =
        
        
        `<div class="di-body">` +
        row(t('di.serial'), d.serial ? esc(d.serial) : '—', d.serialFrom ? esc(d.serialFrom) : '') +
        row(t('di.wiredMac'), d.wiredMac ? esc(d.wiredMac) : '—', d.wiredMac && d.macPath ? esc(d.macPath) : '') +
        row(t('di.wifiMac'), d.wifiMac ? esc(d.wifiMac) : '—') +
        (d.netErr ? row(t('di.macFailed'), esc(explainErr(d.netErr))) : '') +
        row(t('di.model'), d.model ? esc(d.model) : '—') +
        row(t('di.firmware'), d.firmware ? esc(d.firmware) : '—') +
        (d.sysErr ? row(t('di.sysFailed'), esc(explainErr(d.sysErr))) : '') +
        row(t('di.appVersion'), esc(typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '—')) +
        this._mediaRows(row) +
        
        
        
        
        
        row(t('di.openSource'), 'hls.js ' + esc(Hls.version || ''), 'Apache-2.0') +
        (this.showRaw ? this._rawBlock() : '') +
        `</div>` +
        `<div class="btn-row">${btn(0, 'again', t('di.again'))}${btn(1, 'raw', t(this.showRaw ? 'di.rawHide' : 'di.rawShow'))}</div>`;
    }

    this.el.innerHTML = `
      <div class="panel">
        <div class="panel-close" data-role="close">✕</div>
        <h2>${t('settings.deviceInfo')}</h2>
        ${body}
        <div class="hint">${t('di.hint')}</div>
      </div>
    `;

    
    
    const b = this.el.querySelector('.di-body');
    if (b) b.scrollTop = this.scrollTop;
  }

  handleKey(code) {
    switch (code) {
      case KEY.UP:
        this._scroll(-220);
        break;
      case KEY.DOWN:
        this._scroll(220);
        break;
      case KEY.LEFT:
        if (this.focus > 0) this.focus--;
        this.render();
        break;
      case KEY.RIGHT:
        if (this.focus < 1) this.focus++;
        this.render();
        break;
      case KEY.OK:
        if (this.focus === 1) {
          this.showRaw = !this.showRaw;
          this.render();
        } else {
          this._load();
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

  close() {
    this.el.classList.add('hidden');
    if (this.onClose) this.onClose();
  }

  isOpen() {
    return !this.el.classList.contains('hidden');
  }
}
