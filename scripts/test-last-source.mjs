
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

const { getLastSourceIdx, setLastSourceIdx } = await import('../src/core/storage.js');

test('defaults to 0 and reads back after write', () => {
  assert.equal(getLastSourceIdx('ch:cctv|CCTV1'), 0);
  setLastSourceIdx('ch:cctv|CCTV1', 2);
  assert.equal(getLastSourceIdx('ch:cctv|CCTV1'), 2);
});

test('invalid value not written', () => {
  setLastSourceIdx('k', -1);
  setLastSourceIdx('k', 1.5);
  setLastSourceIdx('k', NaN);
  assert.equal(getLastSourceIdx('k'), 0);
});

test('same-channel update keeps newest value', () => {
  setLastSourceIdx('k2', 1);
  setLastSourceIdx('k2', 3);
  assert.equal(getLastSourceIdx('k2'), 3);
});

test('map capped; oldest entry evicted', () => {
  for (let i = 0; i < 405; i++) setLastSourceIdx('cap' + i, 1);
  const map = JSON.parse(localStorage.getItem('iptv:lastSource'));
  assert.equal(Object.keys(map).length, 400);
  assert.equal(map.cap0, undefined);
  assert.equal(map.cap404, 1);
});

test('corrupt storage falls back to 0', () => {
  localStorage.setItem('iptv:lastSource', 'not-json');
  assert.equal(getLastSourceIdx('k2'), 0);
  localStorage.setItem('iptv:lastSource', '[1,2]');
  assert.equal(getLastSourceIdx('k2'), 0);
});
