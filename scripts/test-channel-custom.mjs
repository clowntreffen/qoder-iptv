// Run: node --test scripts/test-channel-custom.mjs

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
  applyChannelOverrides,
  sortGroup,
  orderChannels,
  moveChannel
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



test('normalize: accepts non-empty name, hidden=true, non-zero finite offset', () => {
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

test('normalize: accepts group and order, rejects reserved keys and bad ranks', () => {
  assert.deepEqual(
    normalizeOverrides({
      a: { group: '  Movies  ', order: 2.5 },
      b: { group: '', order: Infinity }
    }),
    { a: { group: 'Movies', order: 2.5 } }
  );
  const hostile = JSON.parse('{"__proto__":{"name":"polluted"}}');
  assert.deepEqual(normalizeOverrides(hostile), {});
  assert.equal(Object.prototype.name, undefined);
});

test('patch/clear: field-level update, blank deletes, null clears', () => {
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

test('applyChannelOverrides: rename, customHidden and EPG offset applied to channel object', () => {
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

test('storage: channelOverrides round-trips, invalid values not persisted', () => {
  setChannelOverrides({ a: { name: 'A', hidden: true }, b: { name: '', hidden: 'yes', epgOffsetMinutes: 'x' } });
  assert.deepEqual(getChannelOverrides(), { a: { name: 'A', hidden: true } });
  localStorage.setItem('iptv:channelOverrides', 'not-json');
  assert.deepEqual(getChannelOverrides(), {});
});



test('editor: OK enters rename and commits; hidden toggle; offset steps; reset', () => {
  const el = new FakeEl();
  const ed = new ChannelEditor(el);
  setChannelOverrides({});
  let changes = 0;
  ed.onChanged = () => { changes++; };
  ed.open(CH);
  assert.equal(ed.focusIdx, 0);

  
  ed.handleKey(KEY.OK);
  assert.equal(ed.entering, true);
  assert.equal(ed.draft, 'Alpha');
  ed.draft = 'New Name';
  ed.handleKey(KEY.OK);
  assert.equal(ed.entering, false);
  assert.equal(getOverride(getChannelOverrides(), CH.key).name, 'New Name');
  assert.equal(changes, 1);

  
  ed.focusIdx = 1;
  ed.handleKey(KEY.OK);
  assert.equal(getOverride(getChannelOverrides(), CH.key).hidden, true);
  assert.equal(changes, 2);

  
  ed.focusIdx = 5;
  ed.handleKey(KEY.RIGHT);
  assert.equal(getOverride(getChannelOverrides(), CH.key).epgOffsetMinutes, 15);
  ed.handleKey(KEY.LEFT);
  assert.equal(getOverride(getChannelOverrides(), CH.key).epgOffsetMinutes, undefined);
  assert.equal(changes, 4);

  
  ed.focusIdx = 6;
  ed.handleKey(KEY.OK);
  assert.equal(getOverride(getChannelOverrides(), CH.key), null);
  assert.equal(changes, 5);
});

test('editor: Back cancels input, close clears channel; XSS text escaped', () => {
  const el = new FakeEl();
  const ed = new ChannelEditor(el);
  setChannelOverrides({});
  ed.open({ ...CH, name: '<img src=x onerror=alert(1)>' });
  ed.handleKey(KEY.OK);
  ed.draft = '<b>bold</b>';
  ed.render();
  assert.match(el.innerHTML, /&lt;b&gt;bold&lt;\/b&gt;/);
  assert.doesNotMatch(el.innerHTML, /<b>bold<\/b>/);

  ed.handleKey(KEY.BACK); 
  assert.equal(ed.entering, false);
  assert.equal(getOverride(getChannelOverrides(), CH.key), null);

  ed.handleKey(KEY.BACK);
  assert.equal(ed.isOpen(), false);
  assert.equal(ed.ch, null);
});



test('ChannelMenu: MENU opens editor callback instead of fav toggle; INFO/YELLOW still toggles fav', () => {
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

test('ChannelMenu: hidden channels stay listed with hidden-entry marker', () => {
  const cm = Object.create(ChannelMenu.prototype);
  cm.currentKey = 'x';
  const html = cm._channelItemHtml({ ...CH, customHidden: true }, 0);
  assert.match(html, /hidden-entry/);
  assert.match(html, /hidden-badge/);
  assert.match(html, /Hidden/);
  assert.doesNotMatch(cm._channelItemHtml(CH, 0), /hidden-entry/);
});



const mk = (name, group = 'News') => ({ key: 'ch:' + group + '|' + name, name, group });

test('order: rank overrides sort a group; groups keep first-seen order', () => {
  const A = mk('A'), B = mk('B'), C = mk('C'), D = mk('D', 'Movies');
  const map = { [C.key]: { order: -5 }, [D.key]: { order: 1 } };
  const out = orderChannels([A, B, C, D], map);
  assert.deepEqual(out.map((c) => c.name), ['C', 'A', 'B', 'D']);
  // No overrides: playlist order is untouched.
  assert.deepEqual(orderChannels([A, B, C], {}).map((c) => c.name), ['A', 'B', 'C']);
  assert.deepEqual(sortGroup([A, B, C], {}).map((c) => c.name), ['A', 'B', 'C']);
});

test('order: move up/down writes one fractional rank and stops at the edges', () => {
  const A = mk('A'), B = mk('B'), C = mk('C');
  const list = [A, B, C];
  let map = moveChannel({}, list, B.key, -1);
  assert.ok(Number.isFinite(map[B.key].order));
  assert.deepEqual(sortGroup(list, map).map((c) => c.name), ['B', 'A', 'C']);

  map = moveChannel(map, list, C.key, -1);
  assert.deepEqual(sortGroup(list, map).map((c) => c.name), ['B', 'C', 'A']);

  // At the top: moving up is a no-op and stores nothing new.
  const before = JSON.stringify(map);
  assert.equal(moveChannel(map, list, B.key, -1), map);
  assert.equal(JSON.stringify(map), before);

  // Unknown key and zero direction change nothing.
  assert.equal(moveChannel(map, list, 'missing', 1), map);
  assert.equal(moveChannel(map, list, B.key, 0), map);
});

test('regroup: group override moves the channel and reset restores the base', () => {
  const A = mk('A'), B = mk('B');
  const channels = [A, B];
  const map = { [B.key]: { group: 'Movies' } };
  applyChannelOverrides(channels, map);
  assert.equal(B.group, 'Movies');
  assert.equal(B.baseGroup, 'News');
  const ordered = orderChannels(channels, map);
  assert.deepEqual(ordered.map((c) => c.name), ['A', 'B']);

  // Clearing the override must restore the playlist values without a reload.
  applyChannelOverrides(channels, {});
  assert.equal(B.group, 'News');
  assert.equal(B.name, 'B');
});

test('editor: move rows reorder the group and the group row cycles groups', () => {
  const el = new FakeEl();
  const ed = new ChannelEditor(el);
  setChannelOverrides({});
  const A = mk('A'), B = mk('B'), C = mk('C');
  let changes = 0;
  ed.onChanged = () => { changes++; };
  ed.open(B, { groups: ['News', 'Movies'], siblings: [A, B, C] });

  // Row 3 is "move up".
  ed.focusIdx = 3;
  ed.handleKey(KEY.OK);
  let map = getChannelOverrides();
  assert.ok(Number.isFinite(map[B.key].order));
  const sorted = sortGroup([A, B, C], map);
  assert.deepEqual(sorted.map((c) => c.name), ['B', 'A', 'C']);

  // Row 4 is "move down": back to the middle.
  ed.focusIdx = 4;
  ed.handleKey(KEY.OK);
  map = getChannelOverrides();
  assert.deepEqual(sortGroup([A, B, C], map).map((c) => c.name), ['A', 'B', 'C']);

  // Row 2 is "group": Right moves to Movies, Left returns to the base group.
  ed.focusIdx = 2;
  ed.handleKey(KEY.RIGHT);
  assert.equal(getOverride(getChannelOverrides(), B.key).group, 'Movies');
  assert.equal(getOverride(getChannelOverrides(), B.key).order, undefined);
  ed.handleKey(KEY.LEFT);
  assert.equal(getOverride(getChannelOverrides(), B.key), null);
  assert.ok(changes >= 4);
});

test('editor: moving without siblings is a no-op', () => {
  const el = new FakeEl();
  const ed = new ChannelEditor(el);
  setChannelOverrides({});
  ed.open(CH);
  let changes = 0;
  ed.onChanged = () => { changes++; };
  ed.focusIdx = 3;
  assert.doesNotThrow(() => ed.handleKey(KEY.OK));
  assert.equal(changes, 0);
});
