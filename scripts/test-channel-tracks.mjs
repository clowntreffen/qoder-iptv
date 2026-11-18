// Run: node --test scripts/test-channel-tracks.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k)
};

const { saveChannelTrack, getChannelTrack, clearChannelTracks, loadChannelTracks, pickSavedTrack } =
  await import('../src/core/channelTracks.js');

test('saves a per-channel audio/subtitle choice', () => {
  clearChannelTracks();
  saveChannelTrack('Live|Das Erste', { audioIndex: 1, audioLabel: 'Stereo', subtitleIndex: -1 });
  assert.deepEqual(getChannelTrack('Live|Das Erste'), {
    audioIndex: 1, audioLabel: 'Stereo', subtitleIndex: -1
  });
});

test('ignores garbage and clears an empty entry', () => {
  clearChannelTracks();
  saveChannelTrack('Live|X', { audioIndex: 'x', audioLabel: '', subtitleLabel: 'y' });
  assert.deepEqual(getChannelTrack('Live|X'), { subtitleLabel: 'y' });
  saveChannelTrack('Live|X', {});
  assert.equal(getChannelTrack('Live|X'), null);
});

test('trims the oldest entries beyond the cap', () => {
  clearChannelTracks();
  for (let i = 0; i < 205; i++) saveChannelTrack('Live|C' + i, { audioIndex: i });
  const map = loadChannelTracks();
  assert.equal(Object.keys(map).length, 200);
  assert.equal(getChannelTrack('Live|C0'), null);
  assert.ok(getChannelTrack('Live|C204'));
});

test('pickSavedTrack prefers a valid index and falls back to label', () => {
  const list = [
    { index: 0, label: 'German' },
    { index: 1, label: 'English' }
  ];
  assert.equal(pickSavedTrack(list, { index: 1, label: 'ignored' }), list[1]);
  assert.equal(pickSavedTrack(list, { index: 9, label: 'english' }), list[1]);
  assert.equal(pickSavedTrack(list, { index: -1, label: '' }), null);
});
