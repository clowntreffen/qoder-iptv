
import test from 'node:test';
import assert from 'node:assert/strict';
import { epgStore as store, normalizeEpgName } from '../src/core/epgStore.js';

test('normalization: spaces, punctuation, quality suffixes', () => {
  assert.equal(normalizeEpgName('CCTV-1 \u9ad8\u6e05'), 'cctv1');
  assert.equal(normalizeEpgName('CCTV1\u7efc\u5408'), 'cctv1');
  assert.equal(normalizeEpgName('\u6df1\u5733\u536b\u89c6 4K'), '\u6df1\u5733\u536b\u89c6');
  assert.equal(normalizeEpgName('\u6e56\u5357\u536b\u89c6HD'), '\u6e56\u5357\u536b\u89c6');
  assert.equal(normalizeEpgName('CHC \u9ad8\u6e05\u7535\u5f71'), 'chc\u7535\u5f71');
});

test('normalization: CCTV numbers and Chinese channel names', () => {
  assert.equal(normalizeEpgName('CCTV-05'), 'cctv5');
  assert.equal(normalizeEpgName('CCTV5\u4f53\u80b2'), 'cctv5');
  assert.equal(normalizeEpgName('CCTV5+\u4f53\u80b2\u8d5b\u4e8b'), 'cctv5+');
  assert.equal(normalizeEpgName('CCTV4\u6b27\u6d32'), 'cctv4\u6b27\u6d32');
  assert.equal(normalizeEpgName('CCTV4\u6b27\u6d32\u9ad8\u6e05'), 'cctv4\u6b27\u6d32');
  assert.equal(normalizeEpgName('\u4e2d\u592e\u7535\u89c6\u53f0\u7efc\u5408\u9891\u9053'), 'cctv1');
  assert.equal(normalizeEpgName('\u4e2d\u592e13\u53f0'), 'cctv13');
  assert.equal(normalizeEpgName('\u4e2d\u592e\u5e7f\u64ad\u7535\u89c6\u603b\u53f0'), '\u4e2d\u592e\u5e7f\u64ad\u7535\u89c6\u603b\u53f0');
});

test('falls back to normalized channel name when tvg-id and exact name miss', () => {
  store._ingestRaw({
    channels: [{ id: 'cctv1.hd', name: '\u4e2d\u592e\u7535\u89c6\u53f0\u7efc\u5408\u9891\u9053' }],
    programmes: [['cctv1.hd', [{ start: 1, stop: 2, title: 'x' }]]]
  });
  const ch = { tvgId: '', name: 'CCTV-1 \u9ad8\u6e05', epgName: 'CCTV-1 \u9ad8\u6e05' };
  assert.equal(store._key(ch), 'cctv1.hd');
});

test('normalization keeps CCTV5 and CCTV5+ distinct', () => {
  store._ingestRaw({
    channels: [{ id: 'c5', name: 'CCTV5\u4f53\u80b2' }, { id: 'c5p', name: 'CCTV5+\u4f53\u80b2\u8d5b\u4e8b' }],
    programmes: [['c5', [{ start: 1, stop: 2, title: 'a' }]], ['c5p', [{ start: 1, stop: 2, title: 'b' }]]]
  });
  assert.equal(store._key({ tvgId: '', name: 'CCTV5', epgName: 'CCTV5' }), 'c5');
  assert.equal(store._key({ tvgId: '', name: 'CCTV5+', epgName: 'CCTV5+' }), 'c5p');
});

test('exact match beats normalized fallback', () => {
  store._ingestRaw({
    channels: [{ id: 'a', name: 'CCTV1' }, { id: 'b', name: 'CCTV-1 \u7efc\u5408' }],
    programmes: [['a', [{ start: 1, stop: 2, title: 'a' }]], ['b', [{ start: 1, stop: 2, title: 'b' }]]]
  });
  assert.equal(store._key({ tvgId: '', name: 'CCTV1', epgName: 'CCTV1' }), 'a');
});
