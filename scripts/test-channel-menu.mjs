// Run: node --test scripts/test-channel-menu.mjs


import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelMenu } from '../src/ui/ChannelMenu.js';
import { logoHtml, logoText, markLogoFailed } from '../src/core/util.js';
import { saveFavorites, recordRecent, clearRecents } from '../src/core/storage.js';

const CHAN_ROW_H = 100; 
const ROWS = 5000;


globalThis.requestAnimationFrame = (fn) => { fn(); return 0; };
globalThis.cancelAnimationFrame = () => {};

class FakeClassList {
  constructor() { this.set = new Set(); }
  add(c) { this.set.add(c); }
  remove(c) { this.set.delete(c); }
  contains(c) { return this.set.has(c); }
  toggle(c, force) {
    const want = force === undefined ? !this.set.has(c) : !!force;
    if (want) this.set.add(c); else this.set.delete(c);
  }
}

class FakeStyle {
  constructor() { this.vars = {}; }
  setProperty(k, v) { this.vars[k] = v; }
}

class FakeEl {
  
  
  constructor(rowClass = null) {
    this.classList = new FakeClassList();
    this.children = [];
    this.style = new FakeStyle();
    this.scrollTop = 0;
    this.clientHeight = 900; 
    this.textContent = '';
    this.dataset = {};
    this._listeners = {};
    this._htmlSets = 0;
    this._rowClass = rowClass;
  }
  set innerHTML(html) {
    this._htmlSets++;
    this._html = html;
    if (!this._rowClass) { this.children = []; return; }
    const re = new RegExp('class="(' + this._rowClass + '[^"]*)"', 'g');
    const kids = [];
    let m;
    while ((m = re.exec(html)) !== null) {
      const el = new FakeEl(this._rowClass);
      for (const c of m[1].split(/\s+/)) if (c) el.classList.add(c);
      kids.push(el);
    }
    this.children = kids;
  }
  get innerHTML() { return this._html || ''; }
  addEventListener(type, fn) { this._listeners[type] = fn; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  scrollIntoView() {}
}

class FakeMenuRoot {
  constructor() {
    this.classList = new FakeClassList();
    this._listeners = {};
    this.byId = {
      'cm-group-list': new FakeEl('cm-group-item'),
      'cm-chan-list': new FakeEl('cm-channel-item'),
      'cm-chan-title': new FakeEl(),
      'cm-dates-col': new FakeEl(),
      'cm-epg-col': new FakeEl(),
      'cm-date-list': new FakeEl('cm-date-item'),
      'cm-epg-title': new FakeEl(),
      'cm-epg-list': new FakeEl('cm-epg-item'),
      'cm-settings': new FakeEl()
    };
  }
  addEventListener(type, fn) { this._listeners[type] = fn; }
  querySelector(sel) {
    if (sel.startsWith('#')) return this.byId[sel.slice(1)] || null;
    return null; 
  }
}

function makeChannels() {
  const groups = ['A', 'B'];
  const channels = [];
  let n = 0;
  for (const g of groups) {
    for (let i = 0; i < ROWS / 2; i++) {
      n++;
      channels.push({
        key: 'ch:' + g + '|' + n,
        name: g + '-' + i,
        epgName: g + '-' + i,
        group: g,
        sources: [{ url: 'http://s/' + n }],
        sourceIdx: 0,
        chno: String(n),
        index: n
      });
    }
  }
  return channels;
}

function useStorage() {
  const data = Object.create(null);
  Object.defineProperties(data, {
    getItem: { value: (k) => (k in data ? data[k] : null) },
    setItem: { value: (k, v) => { data[k] = String(v); } },
    removeItem: { value: (k) => { delete data[k]; } },
    clear: { value: () => { for (const k of Object.keys(data)) delete data[k]; } },
    key: { value: (i) => Object.keys(data)[i] ?? null },
    length: { get: () => Object.keys(data).length }
  });
  globalThis.localStorage = data;
  return data;
}

function setup() {
  const el = new FakeMenuRoot();
  const menu = new ChannelMenu(el);
  const channels = makeChannels();
  const played = [];
  menu.onPlayLive = (ch) => played.push(ch.key);
  menu.onClose = () => { menu._closed = true; };
  return { el, menu, channels, played };
}

test('opening a 5000-channel group renders only the window, padding spans full height', () => {
  const { el, menu, channels } = setup();
  menu.open(channels, channels[0].key);
  const list = el.byId['cm-chan-list'];
  const inGroup = ROWS / 2; 
  assert.equal(menu.isOpen(), true);
  assert.equal(list.children.length, 19); 
  assert.equal(list.style.vars['--sp-top'], '0px');
  assert.equal(list.style.vars['--sp-bottom'], (inGroup - 19) * CHAN_ROW_H + 'px');
  assert.equal(menu._winStart, 0);
  menu.close();
});

test('arrow navigation moves focus classes without rebuilding the channel DOM', () => {
  const { el, menu, channels } = setup();
  menu.open(channels, channels[0].key);
  const list = el.byId['cm-chan-list'];
  const firstRow = list.children[0];
  const builds = list._htmlSets;
  menu.handleKey(40); // DOWN
  menu.handleKey(40);
  assert.equal(list._htmlSets, builds, 'no innerHTML rebuild while focus stays in window');
  assert.equal(list.children[0], firstRow, 'row elements are reused (logos not reloaded)');
  assert.equal(list.children.length, 19);
  assert.equal(menu.chanIdx, 2);
  assert.equal(list.children[2].classList.contains('focused'), true);
  assert.equal(list.children[0].classList.contains('focused'), false);
  menu.close();
});

test('focus beyond the viewport shifts the window and syncs scrollTop', () => {
  const { el, menu, channels } = setup();
  menu.open(channels, channels[0].key);
  const list = el.byId['cm-chan-list'];
  for (let i = 0; i < 10; i++) menu.handleKey(40); 
  assert.equal(menu.chanIdx, 10);
  assert.equal(menu._winStart, 5); 
  assert.equal(list.scrollTop, 5 * CHAN_ROW_H);
  assert.equal(list.children.length, 19);
  assert.equal(list.children[5].classList.contains('focused'), true); // 10 - 5
  menu.close();
});

test('opening near the end of the list centers the window without overrunning', () => {
  const { el, menu, channels } = setup();
  const target = channels[ROWS - 5]; 
  menu.open(channels, target.key);
  const list = el.byId['cm-chan-list'];
  const inGroup = ROWS - 5 - ROWS / 2;
  assert.equal(menu.chanIdx, inGroup);
  assert.equal(menu._winStart, inGroup - 4);
  assert.equal(list.scrollTop, menu._winStart * CHAN_ROW_H);
  assert.equal(list.children.length, 9); 
  assert.equal(list.children[4].classList.contains('focused'), true);
  menu.close();
});

test('clicking a channel row plays it and closes the menu', () => {
  const { el, menu, channels, played } = setup();
  menu.open(channels, channels[0].key);
  menu._onClick({ target: { closest: () => ({ dataset: { role: 'chan', idx: '3' } }) } });
  assert.deepEqual(played, [channels[3].key]);
  assert.equal(menu.isOpen(), false);
  assert.equal(menu._closed, true);
});

test('switching groups re-anchors the window to the top of the new group', () => {
  const { el, menu, channels } = setup();
  menu.open(channels, channels[0].key);
  for (let i = 0; i < 30; i++) menu.handleKey(40); 
  menu.handleKey(37); 
  menu.handleKey(40); 
  menu.handleKey(39); 
  assert.equal(menu.groupIdx, 2); 
  assert.equal(menu.chanIdx, 0);
  const list = el.byId['cm-chan-list'];
  assert.equal(menu._winStart, 0);
  assert.equal(list.scrollTop, 0);
  assert.equal(list.children.length, 19);
  menu.close();
});

test('favorites group always exists and INFO toggles the focused channel', () => {
  saveFavorites([]);
  const { el, menu, channels } = setup();
  menu.open(channels, channels[0].key);
  assert.equal(menu.groups[0].fav, true);
  assert.equal(menu.groups[0].channels.length, 0);
  menu.handleKey(37); 
  menu.handleKey(38); 
  menu.handleKey(39); 
  assert.match(el.byId['cm-chan-list'].innerHTML, /cm-empty/);

  menu.open(channels, channels[0].key);
  menu.handleKey(457); // INFO
  assert.equal(menu.groups[0].channels.length, 1);
  assert.equal(menu.groups[0].channels[0].key, channels[0].key);
  assert.equal(menu.groupIdx, 1); 

  menu.handleKey(457); // INFO
  assert.equal(menu.groups[0].channels.length, 0);
  assert.equal(menu.groupIdx, 1);
  assert.equal(menu.chanIdx, 0);
  menu.close();
  saveFavorites([]);
});

test('opening the menu stays in the real channel group, not Recently Watched or Favourites', () => {
  useStorage();
  saveFavorites([]);
  clearRecents();
  const { menu, channels } = setup();
  const target = channels[ROWS / 2]; // first channel of group B
  
  recordRecent(target.key);
  menu.open(channels, target.key);
  assert.equal(menu.groups[menu.groupIdx].name, 'B');
  assert.equal(menu.groupIdx, 3); // Favourites, Recently Watched, A, B
  
  recordRecent(channels[0].key);
  menu.open(channels, target.key);
  assert.equal(menu.groupIdx, 3, 'recent order must not move the current channel');
  
  saveFavorites([target.key]);
  menu.open(channels, target.key);
  assert.equal(menu.groupIdx, 3, 'a favourite still opens in its own group');
  
  menu.open(channels, 'ch:missing|0');
  assert.equal(menu.groupIdx, 0);
  
  menu.open(channels, target.key);
  menu._toggleFav();
  assert.equal(menu.groupIdx, 3, 'removing a favourite stays in the real group');
  menu.close();
  saveFavorites([]);
  clearRecents();
});

test('playing from the favorites group passes fav zap context; normal groups pass all', () => {
  saveFavorites([channels_key(0), channels_key(ROWS / 2)]);
  const { el, menu, channels } = setup();
  const modes = [];
  menu.onPlayLive = (ch, opts) => modes.push(opts && opts.zapMode);
  
  menu.open(channels, channels[1].key);

  menu._onClick({ target: { closest: () => ({ dataset: { role: 'chan', idx: '0' } }) } });
  assert.deepEqual(modes, ['all']);

  menu.open(channels, channels[1].key);
  menu.handleKey(37); 
  menu.handleKey(38); 
  menu.handleKey(39); 
  assert.equal(menu.groupIdx, 0);
  assert.ok(menu.groups[0].fav);
  menu._onClick({ target: { closest: () => ({ dataset: { role: 'chan', idx: '0' } }) } });
  assert.deepEqual(modes, ['all', 'fav']);
  menu.close();
  saveFavorites([]);
});

function channels_key(i) {
  return 'ch:' + (i < ROWS / 2 ? 'A' : 'B') + '|' + (i + 1);
}

test('tapping the star toggles a favourite without starting playback', () => {
  saveFavorites([]);
  const { el, menu, channels, played } = setup();
  menu.open(channels, channels[0].key);
  const click = (idx) =>
    el._listeners.click({ target: { closest: () => ({ dataset: { role: 'fav', idx: String(idx) } }) } });

  click(0);
  assert.equal(menu.groups[0].channels.length, 1);
  assert.equal(menu.groups[0].channels[0].key, channels[0].key);
  assert.equal(played.length, 0);

  click(0);
  assert.equal(menu.groups[0].channels.length, 0);
  assert.equal(played.length, 0);
  menu.close();
  saveFavorites([]);
});

test('scroll events re-anchor the window by scrollTop (mouse wheel path)', () => {
  const { el, menu, channels } = setup();
  menu.open(channels, channels[0].key);
  const list = el.byId['cm-chan-list'];
  list.scrollTop = 2000 * CHAN_ROW_H;
  list._listeners.scroll();
  assert.equal(menu._winStart, 2000 - 5);
  assert.equal(list.children.length, 19);
  
  list.scrollTop = 0;
  list._listeners.scroll();
  assert.equal(menu._winStart, 0);
  menu.close();
});

test('date column shows the escaped catch-up probe note and re-asks only when it opens or switches channel', () => {
  const { el, menu, channels } = setup();
  const probed = [];
  menu.onProbeCatchup = (ch, opts) => probed.push({ key: ch.key, recheck: !!(opts && opts.recheck) });
  menu.catchupNote = (ch) => 'No catch-up <' + ch.name + '>';
  menu.open(channels, channels[0].key);
  assert.equal(probed.length, 0, 'channel column alone does not probe');
  menu.handleKey(39); 
  const title = el.byId['cm-epg-title'].innerHTML;
  assert.ok(probed.some((p) => p.key === channels[0].key));
  assert.equal(probed[0].recheck, true, 'expanding the date column asks for a fresh check');
  assert.match(title, /<span class="cm-cu-note">No catch-up &lt;A-0&gt;<\/span>$/);

  menu.render(); 
  assert.equal(probed.length, 2);
  assert.equal(probed[1].recheck, false, 'plain re-render does not ask again');

  menu.handleKey(37); 
  menu.handleKey(39); 
  assert.equal(probed.at(-1).recheck, true, 'reopening asks again');
  menu.close();
});

test('date column title has no note span when nothing to report', () => {
  const { el, menu, channels } = setup();
  menu.catchupNote = () => '';
  menu.open(channels, channels[0].key);
  menu.handleKey(39);
  assert.doesNotMatch(el.byId['cm-epg-title'].innerHTML, /cm-cu-note/);
  menu.close();
});

test('text logo derives a short code from the channel name', () => {
  assert.equal(logoText('CCTV-1 \u7efc\u5408'), 'CCTV1');
  assert.equal(logoText('CCTV-5+ \u4f53\u80b2\u8d5b\u4e8b'), 'CCTV5+');
  assert.equal(logoText('\u6e56\u5357\u536b\u89c6'), '\u6e56\u5357');
  assert.equal(logoText('\u30104K\u3011\u8d85\u9ad8\u6e05'), '4K');
  assert.equal(logoText('BBC One'), 'BBC');
  assert.equal(logoText('  '), '?');
});

test('logo html keeps a text tile behind the image so a failed load is not an empty box', () => {
  const plain = logoHtml({ name: '\u6e56\u5357\u536b\u89c6' });
  assert.doesNotMatch(plain, /<img/);
  assert.match(plain, /^<span class="logo-txt logo-c\d w-s">\u6e56\u5357<\/span>$/);
  const withImg = logoHtml({ name: 'CCTV-16 \u5965\u6797\u5339\u514b', logo: 'http://s/a.png?"x' });
  assert.match(withImg, /^<img src="http:\/\/s\/a\.png\?&quot;x"[^>]*onerror="this\.remove\(\)"[^>]*\/><span class="logo-txt logo-c\d w-l">CCTV16<\/span>$/);
});

test('channel column hides the logo slot only when the whole group has no logo URL', () => {
  const { el, menu, channels } = setup();
  const list = el.byId['cm-chan-list'];
  menu.open(channels, channels[0].key);
  assert.equal(list.classList.contains('no-logo'), true);
  menu.close();
  const withLogo = channels.map((ch, i) => (i === 7 ? { ...ch, logo: 'http://s/logo.png' } : ch));
  menu.open(withLogo, withLogo[0].key);
  assert.equal(list.classList.contains('no-logo'), false, 'one logo URL keeps the column');
  menu.handleKey(37); 
  menu.handleKey(40); 
  assert.equal(list.classList.contains('no-logo'), true);
  menu.close();
});

test('logo column collapses when every visible logo URL has failed to load', () => {
  const { el, menu, channels } = setup();
  const list = el.byId['cm-chan-list'];
  const urls = [];
  const withLogo = channels.map((ch, i) => {
    if (i >= 19) return ch; 
    const logo = 'http://broken.test/' + ch.key + '.png';
    urls.push(logo);
    return { ...ch, logo };
  });
  menu.open(withLogo, withLogo[0].key);
  assert.equal(list.classList.contains('no-logo'), false, 'unseen URLs still count as showable');
  for (const u of urls) markLogoFailed(u);
  menu.render();
  assert.equal(list.classList.contains('no-logo'), true);
  assert.doesNotMatch(`<div class="logo">${logoHtml({ name: '\u6e56\u5357\u536b\u89c6', logo: urls[0] })}</div>`, /<img/, 'failed URLs are not requested again');
  menu.close();
});
