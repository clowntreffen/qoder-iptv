// Run: node --test scripts/test-parental-locks.mjs
// 家长锁（分组级）：持久化、GroupManager 锁模式、ChannelMenu 进入分组前的 PIN 闸门。
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

const { getLockedGroups, setLockedGroups, isGroupLocked } = await import('../src/core/storage.js');
const { GroupManager } = await import('../src/ui/GroupManager.js');
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
  constructor() { this.classList = new FakeClassList(); this.innerHTML = ''; this.dataset = {}; }
  querySelector() { return null; }
  addEventListener() {}
}

// ---- 持久化 ----

test('locked groups: default empty, roundtrip, ignore invalid entries', () => {
  assert.deepEqual(getLockedGroups(), []);
  assert.equal(isGroupLocked('Adult'), false);
  setLockedGroups(['Adult', 'Kids', 42, '', null]);
  assert.deepEqual(getLockedGroups(), ['Adult', 'Kids']);
  assert.equal(isGroupLocked('Adult'), true);
  assert.equal(isGroupLocked('Kids'), true);
  assert.equal(isGroupLocked('News'), false);
  localStorage.setItem('iptv:lockedGroups', 'not-json');
  assert.deepEqual(getLockedGroups(), []);
});

// ---- GroupManager 锁模式 ----

test('group manager lock mode: toggle, unlock all, applies with mode', () => {
  const gm = new GroupManager(new FakeEl());
  let applied = null;
  gm.onApply = (names, mode) => { applied = { names, mode }; };
  gm.open([{ name: 'Adult', count: 3 }, { name: 'News', count: 2 }], ['Adult'], 'Src', 'lock');
  assert.equal(gm.mode, 'lock');
  assert.deepEqual([...gm.locked], ['Adult']);

  gm.focusIdx = 1;
  gm._confirm();
  assert.equal(gm.locked.has('News'), true);

  gm.focusIdx = gm.groups.length; // 末行：全部解锁
  gm._confirm();
  assert.equal(gm.locked.size, 0);

  gm.close();
  assert.deepEqual(applied, { names: [], mode: 'lock' });
});

test('group manager hide mode still applies hidden names', () => {
  const gm = new GroupManager(new FakeEl());
  let applied = null;
  gm.onApply = (names, mode) => { applied = { names, mode }; };
  gm.open([{ name: 'Adult', count: 3 }, { name: 'News', count: 2 }, { name: 'Kids', count: 1 }], ['Adult'], 'Src');
  assert.equal(gm.mode, 'hide');
  gm.focusIdx = 1;
  gm._confirm();
  gm.close();
  assert.deepEqual(applied, { names: ['Adult', 'News'], mode: 'hide' });
});

// ---- ChannelMenu 进入闸门 ----

test('channel menu: locked group asks PIN, only enters on success', () => {
  const cm = Object.create(ChannelMenu.prototype);
  cm.groups = [
    { name: 'Fav', channels: [], fav: true, locked: false },
    { name: 'Adult', channels: [], locked: true },
    { name: 'News', channels: [], locked: false }
  ];
  cm.col = 0; // COL_GROUP
  cm.groupIdx = 0;
  cm.chanIdx = 0;
  const calls = [];
  let renders = 0;
  cm.onRequestUnlock = (name, cb) => { calls.push(name); cb(false); };
  cm._loadEpg = () => {};
  cm.render = () => { renders++; };

  cm._enterGroup(1); // 锁定组，PIN 失败
  assert.deepEqual(calls, ['Adult']);
  assert.equal(cm.col, 0, '未解锁不得进入');
  assert.equal(renders, 0);

  cm.onRequestUnlock = (name, cb) => { calls.push(name); cb(true); };
  cm._enterGroup(1);
  assert.equal(cm.col, 1, '解锁后进入频道列');
  assert.equal(cm.groupIdx, 1);
  assert.equal(cm.chanIdx, 0);
  assert.equal(renders, 1);

  cm._enterGroup(2); // 未锁定：直接进
  assert.equal(cm.col, 1);
  assert.equal(cm.groupIdx, 2);
  assert.equal(calls.length, 2, '只有锁定组触发回调');

  cm._enterGroup(0); // 收藏组不算锁定
  assert.equal(cm.groupIdx, 0);
  assert.equal(calls.length, 2);
});
