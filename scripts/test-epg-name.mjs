
import test from 'node:test';
import assert from 'node:assert/strict';
import { epgStore as store, normalizeEpgName } from '../src/core/epgStore.js';

test('normalization: spaces, punctuation, quality suffixes', () => {
  assert.equal(normalizeEpgName('CCTV-1 HD'), 'cctv1');
  assert.equal(normalizeEpgName('TVP 1 HD'), 'tvp1');
  assert.equal(normalizeEpgName('TRT 4K'), 'trt');
  assert.equal(normalizeEpgName('Polsat HD'), 'polsat');
  assert.equal(normalizeEpgName('RTL Television'), 'rtltelevision');
});

test('normalization: CCTV numbers and suffix handling', () => {
  assert.equal(normalizeEpgName('CCTV-05'), 'cctv5');
  assert.equal(normalizeEpgName('CCTV5'), 'cctv5');
  assert.equal(normalizeEpgName('CCTV5+'), 'cctv5+');
  assert.equal(normalizeEpgName('CCTV-4 Europe'), 'cctv4europe');
  assert.equal(normalizeEpgName('CCTV-4 Europe HD'), 'cctv4europe');
});

test('falls back to normalized channel name when tvg-id and exact name miss', () => {
  store._ingestRaw({
    channels: [{ id: 'cctv1.hd', name: 'CCTV-1 HD' }],
    programmes: [['cctv1.hd', [{ start: 1, stop: 2, title: 'x' }]]]
  });
  const ch = { tvgId: '', name: 'CCTV-1 HD', epgName: 'CCTV-1 HD' };
  assert.equal(store._key(ch), 'cctv1.hd');
});

test('normalization keeps CCTV5 and CCTV5+ distinct', () => {
  store._ingestRaw({
    channels: [{ id: 'c5', name: 'CCTV5' }, { id: 'c5p', name: 'CCTV5+' }],
    programmes: [['c5', [{ start: 1, stop: 2, title: 'a' }]], ['c5p', [{ start: 1, stop: 2, title: 'b' }]]]
  });
  assert.equal(store._key({ tvgId: '', name: 'CCTV5', epgName: 'CCTV5' }), 'c5');
  assert.equal(store._key({ tvgId: '', name: 'CCTV5+', epgName: 'CCTV5+' }), 'c5p');
});

test('exact match beats normalized fallback', () => {
  store._ingestRaw({
    channels: [{ id: 'a', name: 'CCTV1' }, { id: 'b', name: 'CCTV-1' }],
    programmes: [['a', [{ start: 1, stop: 2, title: 'a' }]], ['b', [{ start: 1, stop: 2, title: 'b' }]]]
  });
  assert.equal(store._key({ tvgId: '', name: 'CCTV1', epgName: 'CCTV1' }), 'a');
});
