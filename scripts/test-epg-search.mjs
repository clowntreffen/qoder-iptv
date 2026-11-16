// Run: node --test scripts/test-epg-search.mjs
// Pure index/search checks plus the Search overlay mapping programmes to
// channels. No network, no real EPG data.

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

const { programmeEntries, searchProgrammeEntries } = await import('../src/core/epgSearch.js');
const { epgStore } = await import('../src/core/epgStore.js');
const { Search, searchChannels } = await import('../src/ui/Search.js');
const { KEY } = await import('../src/core/keys.js');

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
function fakeEl(map) {
  return {
    innerHTML: '',
    classList: new FakeClassList(),
    addEventListener() {},
    querySelector: (sel) => map[sel] || null,
    querySelectorAll: () => []
  };
}

const HOUR = 3600 * 1000;
const NOW = new Date(2026, 0, 15, 20, 0, 0).getTime();
const at = (h) => NOW + h * HOUR;

function entry(title, start, stop, desc = '', key = 'p1') {
  return { key, title, start, stop, desc };
}

test('programmeEntries flattens the store map with stable keys', () => {
  const map = new Map([
    ['a', [{ start: 10, stop: 20, title: 'One', desc: 'x' }]],
    ['b', [{ start: 30, stop: 40, title: 'Two', desc: '' }]]
  ]);
  assert.deepEqual(programmeEntries(map), [
    { key: 'a', start: 10, stop: 20, title: 'One', desc: 'x' },
    { key: 'b', start: 30, stop: 40, title: 'Two', desc: '' }
  ]);
  assert.deepEqual(programmeEntries(null), []);
});

test('search matches title and description across every term', () => {
  const entries = [
    entry('Final Match', at(-2), at(-1), 'live sports'),
    entry('Morning News', at(1), at(2), 'headlines'),
    entry('Final Highlights', at(3), at(4), 'sports recap')
  ];
  // Upcoming hits rank before a past one.
  assert.deepEqual(
    searchProgrammeEntries(entries, 'final', { now: NOW }).map((e) => e.title),
    ['Final Highlights', 'Final Match']
  );
  assert.deepEqual(
    searchProgrammeEntries(entries, 'sports final', { now: NOW }).map((e) => e.title),
    ['Final Highlights', 'Final Match']
  );
  assert.deepEqual(
    searchProgrammeEntries(entries, 'headlines', { now: NOW }).map((e) => e.title),
    ['Morning News']
  );
  assert.deepEqual(searchProgrammeEntries(entries, 'nothing', { now: NOW }), []);
  assert.deepEqual(searchProgrammeEntries(entries, '   ', { now: NOW }), []);
});

test('search keeps upcoming programmes before past ones and respects the window', () => {
  const entries = [
    entry('Past', at(-3), at(-2), 'prog'),
    entry('Now', at(-1), at(1), 'prog'),
    entry('Next', at(2), at(3), 'prog'),
    entry('Too old', at(-24 * 20), at(-24 * 19), 'prog')
  ];
  const all = searchProgrammeEntries(entries, 'prog', { now: NOW });
  assert.deepEqual(all.map((e) => e.title), ['Now', 'Next', 'Past']);
  assert.deepEqual(
    searchProgrammeEntries(entries, 'prog', { now: NOW, limit: 1 }).map((e) => e.title),
    ['Now']
  );
  // Outside the lookback / lookahead window, so not offered.
  assert.deepEqual(searchProgrammeEntries(entries, 'too', { now: NOW }), []);
  assert.deepEqual(
    searchProgrammeEntries(entries, 'prog', { now: NOW, days: 30 }).map((e) => e.title),
    ['Now', 'Next', 'Past']
  );
});

test('epgStore.programmeEntries caches until the store version changes', () => {
  epgStore.clear();
  epgStore.mode = 'xmltv';
  epgStore.programmes.set('p1', [{ start: NOW, stop: NOW + HOUR, title: 'Cached' }]);
  epgStore.loaded = true;
  epgStore.version++;
  const first = epgStore.programmeEntries();
  assert.equal(epgStore.programmeEntries(), first);
  epgStore.version++;
  assert.notEqual(epgStore.programmeEntries(), first);
  epgStore.clear();
});

test('search overlay lists programmes and plays catch-up for a past one', () => {
  epgStore.clear();
  epgStore.mode = 'xmltv';
  epgStore.loaded = true;
  epgStore.channels = new Map();
  const start = Date.now() - 2 * HOUR;
  epgStore.programmes.set('p1', [
    { start, stop: start + HOUR, title: 'Final Match', desc: 'sports' }
  ]);
  epgStore._buildNameIndex();
  epgStore.version++;

  const channel = {
    key: 'ch:sports|Arena', name: 'Arena', group: 'Sports',
    tvgId: 'p1', catchup: 'append', catchupDays: 7, chno: '1', index: 1
  };
  const nodes = {
    '#search-input': { value: '', focus() {}, blur() {} },
    '#search-results': { innerHTML: '', querySelector: () => null },
    '#search-count': { textContent: '' }
  };
  const search = new Search(fakeEl(nodes));
  const played = [];
  const catchups = [];
  search.onPlay = (ch) => played.push(ch.key);
  search.onPlayCatchup = (ch, prog) => catchups.push([ch.key, prog.title]);
  search.open([channel], 'ch:sports|Arena');

  // Without a query only channels are listed.
  assert.equal(search.results.length, 1);
  assert.equal(search.results[0].key, channel.key);

  search.query = 'final';
  search._renderResults();
  assert.equal(search.results.length, 1);
  assert.equal(search.results[0].kind, 'programme');
  assert.match(nodes['#search-count'].textContent, /0 channels, 1 programmes/);
  assert.match(nodes['#search-results'].innerHTML, /Final Match/);
  assert.match(nodes['#search-results'].innerHTML, /Arena/);

  search.handleKey(KEY.OK);
  assert.deepEqual(played, []);
  assert.deepEqual(catchups, [[channel.key, 'Final Match']]);
  assert.equal(search.isOpen(), false);
  epgStore.clear();
});

test('channel search is unaffected by the programme index', () => {
  const channels = [
    { key: 'a', name: 'Arena One', group: 'Sports', chno: '1', index: 1 },
    { key: 'b', name: 'News', group: 'Info', chno: '2', index: 2 }
  ];
  assert.deepEqual(searchChannels(channels, 'arena').map((c) => c.key), ['a']);
  assert.deepEqual(searchChannels(channels, '').map((c) => c.key), ['a', 'b']);
});
