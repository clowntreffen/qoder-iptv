// 分组显示管理：对「当前源」逐个分组设置显示/隐藏。
// 隐藏的分组不出现在频道菜单，也不参与上下键换台和数字换台。
// 设置按源保存（source.hiddenGroups），与 deadUrls 同一套持久化路径。
import { KEY } from '../core/keys.js';
import { esc } from '../core/util.js';
import { t, groupLabel } from '../core/i18n.js';

export class GroupManager {
  constructor(el) {
    this.el = el;
    this.groups = []; // [{ name, count }] 当前源的全部分组（含已隐藏的，否则没法再打开）
    this.hidden = new Set(); // 已隐藏的分组名（hide 模式）
    this.locked = new Set(); // 已锁的分组名（lock 模式）
    this.mode = 'hide'; // 'hide' | 'lock'
    this.srcName = '';
    this.focusIdx = 0;
    this.msg = ''; // 行内提示（如「至少保留一个分组」）
    this.dirty = false;

    this.onApply = null; // (names: string[], mode: 'hide'|'lock') => void，关闭时若有改动则回调
    this.onClose = null;

    this.el.addEventListener('click', (e) => this._onClick(e));
  }

  _onClick(e) {
    // 鼠标用户没有返回键：点面板外的遮罩区即关闭（关闭时统一提交改动）
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
    this._confirm();
  }

  /**
   * @param {Array<{name:string,count:number}>} groups 当前源的全部分组（隐藏过滤前）
   * @param {Array<string>} names hide 模式=已隐藏的分组名；lock 模式=已锁的分组名
   * @param {string} srcName 当前源名称，仅用于标题提示
   * @param {'hide'|'lock'} mode 面板模式
   */
  open(groups, names, srcName, mode = 'hide') {
    this.groups = groups || [];
    this.mode = mode === 'lock' ? 'lock' : 'hide';
    this.hidden = new Set(this.mode === 'hide' ? (names || []) : []);
    this.locked = new Set(this.mode === 'lock' ? (names || []) : []);
    this.srcName = srcName || '';
    this.focusIdx = 0;
    this.msg = '';
    this.dirty = false;
    this.el.classList.remove('hidden');
    this.render();
  }

  // 行数 = 分组数 + 末尾「全部显示」按钮
  _rowCount() {
    return this.groups.length + 1;
  }

  _visibleCount() {
    return this.groups.filter((g) => !this.hidden.has(g.name)).length;
  }

  render() {
    const lockMode = this.mode === 'lock';
    const listHtml = this.groups.length
      ? this.groups
          .map((g, i) => {
            const off = lockMode ? this.locked.has(g.name) : this.hidden.has(g.name);
            const cls = 'form-row' + (i === this.focusIdx ? ' focused' : '');
            const state = lockMode
              ? (off ? t('gm.rowLocked', { n: g.count }) : t('gm.rowUnlocked', { n: g.count }))
              : (off ? t('gm.rowHidden', { n: g.count }) : t('gm.rowShown', { n: g.count }));
            return `<div class="${cls}" data-role="row" data-idx="${i}">
              <span class="label">${esc(groupLabel(g.name))}</span>
              <span class="value${off ? ' off' : ''}">${state}</span>
            </div>`;
          })
          .join('')
      : `<div class="hint">${t('gm.empty')}</div>`;

    const btnIdx = this.groups.length;
    this.el.innerHTML = `
      <div class="panel">
        <div class="panel-close" data-role="close">✕</div>
        <h2>${lockMode ? t('gm.lockTitle') : t('gm.title')}</h2>
        <div class="hint">${lockMode
          ? t('gm.lockSub', { n: this.locked.size, total: this.groups.length })
          : t('gm.sub', { name: esc(this.srcName), n: this._visibleCount(), total: this.groups.length })}</div>
        <div class="src-list">${listHtml}</div>
        ${this.msg ? `<div class="hint" style="color:#ffb74d">${esc(this.msg)}</div>` : ''}
        <div class="btn-row">
          <div class="btn${this.focusIdx === btnIdx ? ' focused' : ''}" data-role="row" data-idx="${btnIdx}">${lockMode ? t('gm.lockAll') : t('gm.showAll')}</div>
        </div>
        <div class="hint">${lockMode ? t('gm.lockHint') : t('gm.hint')}</div>
      </div>
    `;
    const focused = this.el.querySelector('.focused');
    if (focused && focused.scrollIntoView) focused.scrollIntoView({ block: 'center' });
  }

  _confirm() {
    const lockMode = this.mode === 'lock';
    // 末行：一键恢复/解锁全部分组
    if (this.focusIdx >= this.groups.length) {
      const set = lockMode ? this.locked : this.hidden;
      if (set.size) {
        set.clear();
        this.dirty = true;
      }
      this.msg = '';
      this.render();
      return;
    }
    const g = this.groups[this.focusIdx];
    if (!g) return;
    if (lockMode) {
      if (this.locked.has(g.name)) this.locked.delete(g.name);
      else this.locked.add(g.name);
      this.dirty = true;
      this.msg = '';
      this.render();
      return;
    }
    if (this.hidden.has(g.name)) {
      this.hidden.delete(g.name);
      this.dirty = true;
      this.msg = '';
    } else {
      // 不允许把最后一个可见分组也隐藏掉，否则频道列表会整个空掉
      if (this._visibleCount() <= 1) {
        this.msg = t('gm.keepOne');
        this.render();
        return;
      }
      this.hidden.add(g.name);
      this.dirty = true;
      this.msg = '';
    }
    this.render();
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
      case KEY.RIGHT:
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

  // 关闭即提交：改动在这里一次性回调，避免每按一下都重排频道
  close() {
    this.el.classList.add('hidden');
    if (this.dirty && this.onApply) {
      this.dirty = false;
      const names = this.mode === 'lock' ? [...this.locked] : [...this.hidden];
      this.onApply(names, this.mode);
    }
    if (this.onClose) this.onClose();
  }

  isOpen() {
    return !this.el.classList.contains('hidden');
  }
}
