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

  
  ed.focusIdx = 2;
  ed.handleKey(KEY.RIGHT);
  assert.equal(getOverride(getChannelOverrides(), CH.key).epgOffsetMinutes, 15);
  ed.handleKey(KEY.LEFT);
  assert.equal(getOverride(getChannelOverrides(), CH.key).epgOffsetMinutes, undefined);
  assert.equal(changes, 4);

  
  ed.focusIdx = 3;
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
