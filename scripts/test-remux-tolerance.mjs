// Run: node --test scripts/test-remux-tolerance.mjs
//
// Some IPTV gateways answer remux manifests immediately but delay the first
// segment while the stream is prepared. These tests pin the app-side budgets
// and retry behaviour for that path, using provider-neutral examples.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import Hls from 'hls.js';
import { Player } from '../src/player/Player.js';
import { isRemuxUrl } from '../src/core/net.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));

class FakeVideo {
  constructor() {
    this.currentTime = 10;
    this.ranges = [[10, 16]];
    this.readyState = 2;
    this.paused = false;
    this.ended = false;
    this.seeking = false;
    this.playbackRate = 1;
    this.videoWidth = 0;
    this.error = null;
    this.muted = false;
    this.listeners = new Map();
    this.classList = { remove() {}, add() {} };
  }
  get buffered() {
    const ranges = this.ranges;
    return { length: ranges.length, start: (i) => ranges[i][0], end: (i) => ranges[i][1] };
  }
  addEventListener(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(fn);
  }
  emit(event) { for (const fn of this.listeners.get(event) || []) fn(); }
  play() { return Promise.resolve(); }
  pause() { this.paused = true; }
  load() {}
  removeAttribute() {}
  canPlayType() { return ''; }
}

function fixture(t) {
  t.mock.method(console, 'log', () => {});
  t.mock.method(globalThis, 'fetch', () => Promise.reject(new Error('tests forbid real network')));
  t.mock.method(Hls, 'isSupported', () => true);
  t.mock.method(Hls.prototype, 'attachMedia', () => {});
  t.mock.method(Hls.prototype, 'loadSource', () => {});
  const video = new FakeVideo();
  const player = new Player(video);
  t.after(() => player.stop());
  return { player, video };
}

test('remux manifest pattern is provider-agnostic', () => {
  assert.equal(isRemuxUrl('http://gateway.test/ts/abc123/index.m3u8'), true);
  assert.equal(isRemuxUrl('http://host.test/ts/channel-42/index.m3u8?via=it'), true);
  assert.equal(isRemuxUrl('http://host.test/ts/12345/index.m3u8#t=0'), true);
  assert.equal(isRemuxUrl('http://host.test/ts/abc123/seg0.ts'), false);
  assert.equal(isRemuxUrl('http://host.test/live.m3u8'), false);
  assert.equal(isRemuxUrl('http://host.test/notts/x/index.m3u8'), false);
  assert.equal(isRemuxUrl(''), false);
});

test('remux URLs get wider fragment and manifest budgets than tuning', (t) => {
  const { player } = fixture(t);
  player._rawUrl = 'http://host.test/ts/abc123/index.m3u8';
  player._createHls('http://host.test/ts/abc123/index.m3u8');
  const cfg = player.hls.config;
  assert.equal(cfg.fragLoadingTimeOut, 35000);
  assert.equal(cfg.manifestLoadingTimeOut, 30000);
  assert.equal(cfg.fragLoadingMaxRetry, 5);
  assert.equal(cfg.fragLoadingRetryDelay, 1000);
});

test('non-remux URLs keep the user tuning values', (t) => {
  const { player } = fixture(t);
  player._rawUrl = 'http://host.test/live.m3u8';
  player._createHls('http://host.test/live.m3u8');
  const cfg = player.hls.config;
  assert.equal(cfg.fragLoadingTimeOut, 15000);
  assert.equal(cfg.manifestLoadingTimeOut, 16000);
  assert.equal(cfg.fragLoadingMaxRetry, 3);
});

test('remux playback uses the longer startup budget', (t) => {
  const { player } = fixture(t);
  player.playLive({ name: 'R', url: 'http://host.test/ts/abc123/index.m3u8' }, 'hls');
  assert.equal(player._startupTimeoutMs, 40000);
});

test('503 remux errors retry with backoff instead of failing', async (t) => {
  const { player } = fixture(t);
  const originalOn = Hls.prototype.on;
  let handler;
  t.mock.method(Hls.prototype, 'on', function(event, callback, ...args) {
    if (event === Hls.Events.ERROR) handler = callback;
    return originalOn.call(this, event, callback, ...args);
  });
  let starts = 0;
  let errors = 0;
  player.onError = () => errors++;
  player.playLive({ name: 'R', url: 'http://host.test/ts/abc123/index.m3u8' }, 'hls');
  const hls = player.hls;
  hls.startLoad = () => { starts++; };
  t.mock.timers.enable({ apis: ['setTimeout'], now: 0 });
  t.after(() => t.mock.timers.reset());

  handler(Hls.Events.ERROR, {
    fatal: true,
    type: Hls.ErrorTypes.NETWORK_ERROR,
    details: 'fragLoadError',
    response: { code: 503, text: 'remux busy' }
  });
  assert.equal(starts, 0, 'backoff must not restart immediately');
  assert.equal(errors, 0);
  t.mock.timers.tick(1000);
  assert.equal(starts, 1);
  assert.equal(errors, 0);
});

test('permanent 4xx network errors still fail fast', (t) => {
  const { player } = fixture(t);
  const originalOn = Hls.prototype.on;
  let handler;
  t.mock.method(Hls.prototype, 'on', function(event, callback, ...args) {
    if (event === Hls.Events.ERROR) handler = callback;
    return originalOn.call(this, event, callback, ...args);
  });
  let errors = 0;
  player.onError = () => errors++;
  player.playLive({ name: 'R', url: 'http://host.test/ts/abc123/index.m3u8' }, 'hls');
  handler(Hls.Events.ERROR, {
    fatal: true,
    type: Hls.ErrorTypes.NETWORK_ERROR,
    details: 'manifestLoadError',
    response: { code: 404 }
  });
  assert.equal(errors, 1);
});

test('prewarm hits the remux manifest once per dedupe window', async (t) => {
  const { player } = fixture(t);
  const calls = [];
  t.mock.method(globalThis, 'fetch', (url, init) => {
    calls.push({ url, init });
    return Promise.resolve({ status: 206, body: { cancel() {} } });
  });
  const url = 'http://host.test/ts/abc123/index.m3u8';
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);

  player.prewarm(url);
  player.prewarm(url);
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, url);
  assert.equal(calls[0].init.cache, 'no-store');

  now += 15001;
  player.prewarm(url);
  await flush();
  assert.equal(calls.length, 2);

  player.prewarm('http://host.test/live.m3u8');
  await flush();
  assert.equal(calls.length, 2, 'non-remux URLs are not prewarmed');
});

test('main start watchdog uses the remux budget for the selected URL', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const a = source.indexOf('function startTimeoutMs(');
  const b = source.indexOf('\n}', a) + 2;
  const c = source.indexOf('function beginLoading(');
  const d = source.indexOf('function endLoading()', c);
  let id = 0;
  const timers = new Map();
  const context = vm.createContext({
    isRemuxUrl,
    player: { current: { url: 'http://host.test/live.m3u8' } },
    START_TIMEOUT_MS: 15000,
    REMUX_START_TIMEOUT_MS: 40000,
    zapStarting: false,
    zapStartAt: 0,
    startWatchdog: null,
    stallTimer: null,
    onStartTimeout() {},
    netSpeed: { reset() {} },
    loading() {},
    setTimeout: (fn, ms) => { timers.set(++id, { fn, ms }); return id; },
    clearTimeout() {}
  });
  vm.runInContext(source.slice(a, b) + '\n' + source.slice(c, d), context);
  context.beginLoading(false, 'http://host.test/ts/abc123/index.m3u8');
  assert.equal(timers.get(context.startWatchdog).ms, 40000);
  context.beginLoading(false, 'http://host.test/live.m3u8');
  assert.equal(timers.get(context.startWatchdog).ms, 15000);
});
