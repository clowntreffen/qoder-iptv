import test from 'node:test';
import assert from 'node:assert/strict';
import { KEY } from '../src/core/keys.js';
import { Search, searchChannels } from '../src/ui/Search.js';
import { PinEntry } from '../src/ui/PinEntry.js';
import { Player } from '../src/player/Player.js';

const channels = [
  { key: 'a', name: 'CCTV-1 HD', group: 'News', chno: 1, index: 1 },
  { key: 'b', name: 'CCTV-5 Sports', group: 'Sports', chno: 5, index: 2 },
  { key: 'c', name: 'Phoenix Info', group: 'News', chno: 12, index: 3 }
];

function fakeEl(extra = {}) {
  const classes = new Set(['hidden']);
  return {
    innerHTML: '',
    addEventListener() {},
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c)
    },
    ...extra
  };
}

test('channel search matches name, group, number and every term', () => {
  assert.deepEqual(searchChannels(channels, 'cctv').map((c) => c.key), ['a', 'b']);
  assert.deepEqual(searchChannels(channels, 'news').map((c) => c.key), ['a', 'c']);
  assert.deepEqual(searchChannels(channels, '5').map((c) => c.key), ['b']);
  assert.deepEqual(searchChannels(channels, 'news phoenix').map((c) => c.key), ['c']);
  assert.deepEqual(searchChannels(channels, 'missing'), []);
  assert.deepEqual(searchChannels(channels, '').map((c) => c.key), ['a', 'b', 'c']);
});

test('search overlay renders results and keyboard selection plays the channel', () => {
  const nodes = {
    '#search-input': { value: '', focus() {} },
    '#search-results': { innerHTML: '', querySelector: () => null },
    '#search-count': { textContent: '' }
  };
  const el = fakeEl({ querySelector: (s) => nodes[s] || null });
  const search = new Search(el);
  const played = [];
  search.onPlay = (ch) => played.push(ch.key);
  search.open(channels, 'a');
  assert.equal(search.results.length, 3);
  assert.equal(search.sel, 0);
  search.handleKey(KEY.DOWN);
  assert.equal(search.results[search.sel].key, 'b');
  search.handleKey(KEY.OK);
  assert.deepEqual(played, ['b']);
  assert.equal(search.isOpen(), false);
});

test('PIN entry accepts four digits, reports a wrong PIN and cancels on Back', () => {
  const el = fakeEl();
  const pin = new PinEntry(el);
  const seen = [];
  pin.open({
    onSubmit: (value) => {
      seen.push(value);
      return value !== '1111';
    }
  });
  for (const d of [1, 1, 1, 1]) pin.handleKey(KEY.NUM_0 + d);
  assert.deepEqual(seen, ['1111']);
  assert.equal(pin.isOpen(), true);
  assert.equal(pin.error, true);
  for (const d of [1, 2, 3, 4]) pin.handleKey(KEY.NUM_0 + d);
  assert.deepEqual(seen, ['1111', '1234']);
  assert.equal(pin.isOpen(), false);

  let cancelled = 0;
  pin.open({ onSubmit: () => true, onCancel: () => cancelled++ });
  pin.handleKey(KEY.BACK);
  assert.equal(cancelled, 1);
  assert.equal(pin.isOpen(), false);
});

test('native audio and subtitle track cycling updates track state', () => {
  const player = Object.create(Player.prototype);
  const audio = [
    { label: 'English', language: 'en', enabled: true },
    { label: 'German', language: 'de', enabled: false }
  ];
  const text = [
    { kind: 'subtitles', label: 'English', language: 'en', mode: 'disabled' },
    { kind: 'captions', label: 'German', language: 'de', mode: 'disabled' }
  ];
  player.video = { audioTracks: audio, textTracks: text };
  player.hls = null;
  let state = player.getTrackState();
  assert.equal(state.audioIndex, 0);
  assert.equal(state.audio[1].label, 'German (de)');
  assert.equal(state.subtitleIndex, -1);
  state = player.cycleAudio(1);
  assert.equal(state.audioIndex, 1);
  assert.equal(audio[1].enabled, true);
  assert.equal(audio[0].enabled, false);
  state = player.cycleSubtitle(1);
  assert.equal(state.subtitleIndex, 0);
  assert.equal(text[0].mode, 'showing');
  state = player.cycleSubtitle(1);
  assert.equal(state.subtitleIndex, 1);
  assert.equal(text[1].mode, 'showing');
  state = player.cycleSubtitle(1);
  assert.equal(state.subtitleIndex, -1);
  assert.equal(text[0].mode, 'disabled');
  assert.equal(text[1].mode, 'disabled');
});

test('native subtitle track indexes survive non-subtitle text tracks', () => {
  const player = Object.create(Player.prototype);
  const text = [
    { kind: 'chapters', label: 'Chapters', mode: 'disabled' },
    { kind: 'metadata', label: 'Metadata', mode: 'disabled' },
    { kind: 'subtitles', label: 'English', language: 'en', mode: 'showing' }
  ];
  player.video = { audioTracks: [], textTracks: text };
  player.hls = null;
  let state = player.getTrackState();
  assert.deepEqual(state.subtitles.map((track) => track.index), [2]);
  assert.equal(state.subtitleIndex, 2);
  state = player.cycleSubtitle(1);
  assert.equal(state.subtitleIndex, -1);
  assert.equal(text[2].mode, 'disabled');
  state = player.cycleSubtitle(1);
  assert.equal(state.subtitleIndex, 2);
  assert.equal(text[2].mode, 'showing');
});

test('hls audio and subtitle cycling uses hls.js track indexes', () => {
  const player = Object.create(Player.prototype);
  player.video = {};
  player.hls = {
    audioTracks: [{ label: 'Main' }, { label: 'Commentary' }],
    audioTrack: 0,
    subtitleTracks: [{ label: 'English' }],
    subtitleTrack: -1,
    subtitleDisplay: false
  };
  assert.equal(player.cycleAudio(1).audioIndex, 1);
  assert.equal(player.hls.audioTrack, 1);
  let state = player.cycleSubtitle(1);
  assert.equal(state.subtitleIndex, 0);
  assert.equal(player.hls.subtitleTrack, 0);
  assert.equal(player.hls.subtitleDisplay, true);
  state = player.cycleSubtitle(-1);
  assert.equal(state.subtitleIndex, -1);
  assert.equal(player.hls.subtitleDisplay, false);
});
