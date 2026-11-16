import test from 'node:test';
import assert from 'node:assert/strict';
import { activeDeadUrls, mergeDeadUrls, stampDeadUrls, DEAD_URL_TTL_MS } from '../src/core/deadUrls.js';

const NOW = 1_700_000_000_000;

test('dead URLs stay active for twelve hours, then expire', () => {
  const source = {
    deadUrls: ['a', 'b'],
    deadUrlsAt: { a: NOW, b: NOW - DEAD_URL_TTL_MS }
  };
  assert.deepEqual(activeDeadUrls(source, NOW), ['a']);
  assert.deepEqual(activeDeadUrls(source, NOW + DEAD_URL_TTL_MS - 1), ['a']);
  assert.deepEqual(activeDeadUrls(source, NOW + DEAD_URL_TTL_MS), []);
});

test('missing or invalid timestamps are not treated as permanent blacklists', () => {
  assert.deepEqual(activeDeadUrls({ deadUrls: ['a'] }, NOW), []);
  assert.deepEqual(activeDeadUrls({ deadUrls: ['a'], deadUrlsAt: { a: 'x' } }, NOW), []);
  assert.deepEqual(activeDeadUrls({ deadUrls: ['a'], deadUrlsAt: { a: NOW + 1 } }, NOW), []);
  assert.deepEqual(activeDeadUrls(null, NOW), []);
});

test('merge preserves earlier timestamps and stamps new dead URLs', () => {
  const previous = { a: NOW - 1000, gone: NOW - 2000 };
  assert.deepEqual(mergeDeadUrls(['a', 'b'], previous, NOW), {
    a: NOW - 1000,
    b: NOW
  });
  assert.deepEqual(mergeDeadUrls([], previous, NOW), {});
});

test('stampDeadUrls ignores empty entries and uses one timestamp', () => {
  assert.deepEqual(stampDeadUrls(['a', '', null, 'b'], NOW), { a: NOW, b: NOW });
});
