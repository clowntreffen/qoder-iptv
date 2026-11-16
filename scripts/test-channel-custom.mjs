// Run: node --test scripts/test-channel-custom.mjs
// 频道自定义：按 ch.key 持久化改名/隐藏/EPG 偏移，编辑器键控，菜单 MENU 入口与隐藏标记。
import test from 'node:test';
import assert from 'node:assert/strict';

const mem = Object.create(null);
globalThis.localStorage = {
  get length() { return Object.keys(mem).length; },
  key: (i) => Object.keys(mem)[i],
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; }
};

const { KEY } = await import('../src/core/keys.js');
const {
  normalizeOverrides,
  getOverride,
  patchOverride,
  clearOverride,
  applyChannelOverrides
} = await import('../src/core/channelCustomization.js');
const { getChannelOverrides, setChannelOverrides } = await import('../src/core/storage.js');
const { ChannelEditor } = await import('../src/ui/ChannelEditor.js');
const { ChannelMenu } = await import('../src/ui/ChannelMenu.js');

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
class FakeEl {
  constructor() { this.classList = new FakeClassList(); this.innerHTML = ''; this.dataset = {}; this.value = ''; }
  querySelector() { return null; }
  addEventListener() {}
}

const CH = { key: 'ch:g|Alpha', name: 'Alpha', group: 'News' };

// ---- 核心数据 ----

test('normalize: 只接受非空名字、hidden=true、非零有限偏移', () => {
  assert.deepEqual(normalizeOverrides(null), {});
  assert.deepEqual(normalizeOverrides({ a: null, b: 3, c: [] }), {});
  assert.deepEqual(
    normalizeOverrides({
      a: { name: '  X  ', hidden: true, epgOffsetMinutes: -30 },
      b: { name: '   ', hidden: false, epgOffsetMinutes: 0 },
      c: { name: '<b>', epgOffsetMinutes: 1.6 }
    }),
    { a: { name: 'X', hidden: true, epgOffsetMinutes: -30 }, c: { name: '<b>', epgOffsetMinutes: 2 } }
  );
});

test('patch/clear：字段级更新，空值删除，整条清空', () => {
  let map = {};
  map = patchOverride(map, CH.key, { name: 'Beta', hidden: true, epgOffsetMinutes: 15 });
  assert.deepEqual(getOverride(map, CH.key), { name: 'Beta', hidden: true, epgOffsetMinutes: 15 });

  map = patchOverride(map, CH.key, { hidden: false, epgOffsetMinutes: null });
  assert.deepEqual(getOverride(map, CH.key), { name: 'Beta' });

  map = patchOverride(map, CH.key, { name: '' });
  assert.equal(getOverride(map, CH.key), null);

  map = patchOverride(map, CH.key, { name: 'Z' });
  map = clearOverride(map, CH.key);
  assert.equal(getOverride(map, CH.key), null);
});

test('applyChannelOverrides：改名、customHidden、EPG 偏移重放到频道对象', () => {
  const channels = [
    { key: 'a', name: 'A', group: 'G' },
    { key: 'b', name: 'B', group: 'G' }
  ];
  applyChannelOverrides(channels, {
    a: { name: 'A2', hidden: true, epgOffsetMinutes: 45 },
    b: { epgOffsetMinutes: 30 }
  });
  assert.equal(channels[0].name, 'A2');
  assert.equal(channels[0].customHidden, true);
  assert.equal(channels[0].epgOffsetMinutes, 45);
  assert.equal(channels[1].customHidden, false);
  assert.equal(channels[1].epgOffsetMinutes, 30);
});

test('storage：channelOverrides 往返且非法值不落盘', () => {
  setChannelOverrides({ a: { name: 'A', hidden: true }, b: { name: '', hidden: 'yes', epgOffsetMinutes: 'x' } });
  assert.deepEqual(getChannelOverrides(), { a: { name: 'A', hidden: true } });
  localStorage.setItem('iptv:channelOverrides', 'not-json');
  assert.deepEqual(getChannelOverrides(), {});
});

// ---- 编辑器 ----

test('编辑器：OK 进入改名并提交；隐藏切换；偏移左右调档；重置', () => {
  const el = new FakeEl();
  const ed = new ChannelEditor(el);
  setChannelOverrides({});
  let changes = 0;
  ed.onChanged = () => { changes++; };
  ed.open(CH);
  assert.equal(ed.focusIdx, 0);

  // 改名：OK 进入输入态，草稿为当前名；OK 提交
  ed.handleKey(KEY.OK);
  assert.equal(ed.entering, true);
  assert.equal(ed.draft, 'Alpha');
  ed.draft = 'New Name';
  ed.handleKey(KEY.OK);
  assert.equal(ed.entering, false);
  assert.equal(getOverride(getChannelOverrides(), CH.key).name, 'New Name');
  assert.equal(changes, 1);

  // 隐藏：第 2 行 OK
  ed.focusIdx = 1;
  ed.handleKey(KEY.OK);
  assert.equal(getOverride(getChannelOverrides(), CH.key).hidden, true);
  assert.equal(changes, 2);

  // 偏移：第 3 行，右键 +15，左键回 0
  ed.focusIdx = 2;
  ed.handleKey(KEY.RIGHT);
  assert.equal(getOverride(getChannelOverrides(), CH.key).epgOffsetMinutes, 15);
  ed.handleKey(KEY.LEFT);
  assert.equal(getOverride(getChannelOverrides(), CH.key).epgOffsetMinutes, undefined);
  assert.equal(changes, 4);

  // 重置：第 4 行
  ed.focusIdx = 3;
  ed.handleKey(KEY.OK);
  assert.equal(getOverride(getChannelOverrides(), CH.key), null);
  assert.equal(changes, 5);
});

test('编辑器：Back 在输入态取消，关闭后清空当前频道；XSS 文案被转义', () => {
  const el = new FakeEl();
  const ed = new ChannelEditor(el);
  setChannelOverrides({});
  ed.open({ ...CH, name: '<img src=x onerror=alert(1)>' });
  ed.handleKey(KEY.OK);
  ed.draft = '<b>bold</b>';
  ed.render();
  assert.match(el.innerHTML, /&lt;b&gt;bold&lt;\/b&gt;/);
  assert.doesNotMatch(el.innerHTML, /<b>bold<\/b>/);

  ed.handleKey(KEY.BACK); // 输入态 Back = 取消，不提交
  assert.equal(ed.entering, false);
  assert.equal(getOverride(getChannelOverrides(), CH.key), null);

  ed.handleKey(KEY.BACK);
  assert.equal(ed.isOpen(), false);
  assert.equal(ed.ch, null);
});

// ---- 菜单入口 ----

test('ChannelMenu：MENU 打开编辑回调，不再切收藏；INFO/YELLOW 仍切收藏', () => {
  const cm = Object.create(ChannelMenu.prototype);
  cm.col = 1; // COL_CHAN
  cm.groupIdx = 0;
  cm.chanIdx = 0;
  cm.groups = [{ name: 'News', channels: [CH], locked: false }];
  const edits = [];
  let favs = 0;
  cm.onEditChannel = (ch) => { edits.push(ch.key); };
  cm._toggleFav = () => { favs++; };

  cm.handleKey(KEY.MENU);
  assert.deepEqual(edits, [CH.key]);
  assert.equal(favs, 0);

  cm.handleKey(KEY.INFO);
  assert.equal(favs, 1);
  cm.handleKey(KEY.YELLOW);
  assert.equal(favs, 2);
  assert.deepEqual(edits, [CH.key]);
});

test('ChannelMenu：隐藏的频道仍在菜单列出并带 hidden-entry 标记', () => {
  const cm = Object.create(ChannelMenu.prototype);
  cm.currentKey = 'x';
  const html = cm._channelItemHtml({ ...CH, customHidden: true }, 0);
  assert.match(html, /hidden-entry/);
  assert.match(html, /hidden-badge/);
  assert.match(html, /Hidden/);
  assert.doesNotMatch(cm._channelItemHtml(CH, 0), /hidden-entry/);
});
