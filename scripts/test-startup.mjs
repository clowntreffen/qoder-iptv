import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import Hls from 'hls.js';
import { Player, isHlsUrl } from '../src/player/Player.js';
import { NetSpeed } from '../src/ui/NetSpeed.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));
const ranges = (items) => ({ length: items.length, start: (i) => items[i][0], end: (i) => items[i][1] });

test('webOS graphics use a 4K canvas for native sharpness on UHD panels', async () => {
  const info = JSON.parse(await readFile(new URL('../appinfo.json', import.meta.url), 'utf8'));
  assert.equal(info.resolution, '3840x2160');
});

test('reverse-proxy URLs whose target ends in .m3u8 use hls.js', () => {
  assert.equal(isHlsUrl('http://proxy.test/p3?url=http%3A%2F%2Fhost.test%2Findex.m3u8&via=it'), true);
  assert.equal(isHlsUrl('http://proxy.test/p3.m3u8?url=http%3A%2F%2Fhost.test%2Findex.m3u8&via=it'), true);
  assert.equal(isHlsUrl('http://proxy.test/p3?url=http%3A%2F%2Fhost.test%2Findex.m3u'), false);
  assert.equal(isHlsUrl('http://host.test/live.ts'), false);
});

function fixture(t) {
  t.mock.method(console, 'log', () => {});
  const listeners = new Map();
  const video = {
    currentTime: 10,
    buffered: ranges([[10, 16]]),
    readyState: 2,
    paused: false,
    ended: false,
    seeking: false,
    playbackRate: 1,
    videoWidth: 0,
    error: null,
    muted: false,
    addEventListener(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
    },
    emit(event) { for (const fn of listeners.get(event) || []) fn(); },
    play() { return Promise.resolve(); },
    pause() { this.paused = true; },
    removeAttribute() {},
    load() {},
    canPlayType() { return ''; }
  };
  const player = new Player(video);
  player.current = { channel: { name: 'Test' }, url: 'https://example.test/live.m3u8' };
  player._activePath = 'hls';
  player._phase = { t0: Date.now() };
  player.hls = { config: { maxBufferLength: 30 }, destroy() {} };
  t.after(() => player.stop());
  return { player, video };
}

test('play() AbortError does not mute or retry', async (t) => {
  const { player, video } = fixture(t);
  let calls = 0;
  video.play = () => { calls++; return Promise.reject(new DOMException('interrupted', 'AbortError')); };
  player._tryPlay();
  await flush();
  assert.equal(calls, 1);
  assert.equal(video.muted, false);
});

test('only autoplay rejection of current source mutes and retries', async (t) => {
  const { player, video } = fixture(t);
  let calls = 0;
  video.play = () => ++calls === 1
    ? Promise.reject(new DOMException('blocked', 'NotAllowedError'))
    : Promise.resolve();
  player._tryPlay();
  await flush();
  assert.equal(calls, 2);
  assert.equal(video.muted, true);
});

test('after zap/native fallback/stop, stale play promise must not retry', async (t) => {  const { player, video } = fixture(t);
  for (const change of [
    () => { player._phase = { t0: Date.now() }; },
    () => { player._activePath = 'native'; },
    () => { player.stop(); }
  ]) {
    let reject;
    let calls = 0;
    player._activePath = 'hls';
    video.muted = false;
    video.play = () => { calls++; return new Promise((_, no) => { reject = no; }); };
    player._tryPlay();
    change();
    reject(new DOMException('late', 'NotAllowedError'));
    await flush();
    assert.equal(calls, 1);
    assert.equal(video.muted, false);
  }
});

test('native decode error mid-playback reloads twice before reporting', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 });
  const { player, video } = fixture(t);
  player._activePath = 'native';
  player._proxiedUrl = player.current.url;
  player._playedOnce = true;
  let reloads = 0;
  let errors = 0;
  player._startNative = () => { reloads++; };
  player.onError = () => { errors++; };
  video.error = { code: 3 };
  video.emit('error');
  assert.equal(errors, 0, 'first error reconnects silently');
  t.mock.timers.tick(1200);
  assert.equal(reloads, 1);
  video.emit('error');
  t.mock.timers.tick(2400);
  assert.equal(reloads, 2);
  video.emit('error');
  assert.equal(reloads, 2, 'reload count capped');
  assert.equal(errors, 1, 'error surfaces only after reloads exhausted');
  video.error = null;
});

test('instant native start failure and catch-up errors skip reload', (t) => {
  const { player, video } = fixture(t);
  player._activePath = 'native';
  player._proxiedUrl = player.current.url;
  let reloads = 0;
  let errors = 0;
  player._startNative = () => { reloads++; };
  player.onError = () => { errors++; };
  video.error = { code: 3 };
  video.emit('error');
  assert.equal(reloads, 0, 'no frame shown: reload cannot fix format');
  assert.equal(errors, 1);
  player.mode = 'catchup';
  player._playedOnce = true;
  video.emit('error');
  assert.equal(reloads, 0, 'catch-up reload loses position');
  assert.equal(errors, 2);
  video.error = null;
});

test('4K/HEVC native decode error skips reload and remembers URL', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 });
  const { player, video } = fixture(t);
  player._activePath = 'native';
  player._proxiedUrl = player.current.url;
  player._playedOnce = true;
  player.current.channel.name = 'CCTV-4K';
  let reloads = 0;
  let errors = 0;
  player._startNative = () => { reloads++; };
  player.onError = () => { errors++; };
  video.error = { code: 3 };
  video.emit('error');
  t.mock.timers.tick(5000);
  assert.equal(reloads, 0, 'broken 4K stream does not restart decode pipeline');
  assert.equal(errors, 1);
  assert.equal(player._nativeBad.has(player.current.url), true);
  assert.equal(player._nativeAllowed(player.current.url), false, 'URL stays off native this session');
  video.error = null;
});

test('two hard native failures trip session fuse with one notice', (t) => {
  const { player, video } = fixture(t);
  player._activePath = 'native';
  player._proxiedUrl = player.current.url;
  player._playedOnce = true;
  player.current.channel.name = 'CCTV-4K';
  let notices = 0;
  player.onNotice = () => { notices++; };
  player.onError = () => {};
  video.error = { code: 3 };
  video.emit('error');
  assert.equal(player._nativeOff, false, 'one failure does not trip fuse');
  assert.equal(notices, 0);
  video.emit('error');
  assert.equal(player._nativeOff, true);
  assert.equal(notices, 1);
  video.emit('error');
  assert.equal(notices, 1, 'notice sent once');
  player._decoder = 'native';
  player._triedNativeFallback = false;
  assert.equal(player._fallbackToNative('media'), false, 'no native fallback after fuse');
  assert.equal(player._willUseNative('https://example.test/other.m3u8'), false);
  assert.equal(player._looksHevc('https://example.test/other.m3u8'), false);
  video.error = null;
});

function clock(t) {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 100000 });
  return (ms) => t.mock.timers.tick(ms);
}

test('first frame stalls over 1s at buffer edge: nudge 50ms once', (t) => {
  const tick = clock(t);
  const { player, video } = fixture(t);
  player._watchStartup();
  tick(800);
  assert.equal(video.currentTime, 10);
  tick(200);
  assert.equal(video.currentTime, 10.05);
  assert.equal(player.startupStatus().nudged, true);
  assert.equal(player.startupStatus().motion, null);
  video.currentTime = 10;
  tick(2000);
  assert.equal(video.currentTime, 10, 'must not seek repeatedly');
});

test('normal start ends watch on progress without delayed play or correction', (t) => {
  const tick = clock(t);
  const { player, video } = fixture(t);
  let calls = 0;
  video.play = () => { calls++; return Promise.resolve(); };
  player._tryPlay();
  player._watchStartup();
  assert.equal(calls, 1);
  video.currentTime = 10.25;
  tick(200);
  assert.equal(player.startupStatus().reason, 'moving');
  assert.equal(player.startupStatus().nudged, false);
  assert.equal(player._startupTimer, null);
  tick(5000);
  assert.equal(video.currentTime, 10.25);
});

test('playing/first-frame readiness cannot fake progress', (t) => {
  const tick = clock(t);
  const { player, video } = fixture(t);
  player._watchStartup();
  video.emit('loadeddata');
  video.emit('playing');
  tick(200);
  const status = player.startupStatus();
  assert.equal(status.data, 0);
  assert.equal(status.playing, 0);
  assert.equal(status.motion, null);
  assert.notEqual(status.reason, 'moving');
});

for (const [name, configure] of [
  ['low buffer', (p, v) => { v.buffered = ranges([[10, 10.4]]); }],
  ['AV buffer has hole', (p, v) => { v.buffered = ranges([[9, 10.1], [10.3, 20]]); }],
  ['playhead in hole', (p, v) => { v.currentTime = 10.2; v.buffered = ranges([[9, 10.1], [10.3, 20]]); }],
  ['seeking', (p, v) => { v.seeking = true; }],
  ['no current frame', (p, v) => { v.readyState = 1; }],
  ['later frame exists, leave recovery to HLS', (p, v) => { v.readyState = 3; }],
  ['enough data, leave recovery to HLS', (p, v) => { v.readyState = 4; }],
  ['paused', (p, v) => { v.paused = true; }],
  ['mid-fragment position', (p, v) => { v.currentTime = 11; }],
  ['catch-up', (p) => { p.mode = 'catchup'; }],
  ['main fragment incomplete', (p) => { p.hls.inFlightFragments = { main: { state: 'PARSING', frag: { start: 10 } } }; }],
  ['audio fragment incomplete', (p) => { p.hls.inFlightFragments = { audio: { state: 'FRAG_LOADING', frag: { start: 9.8 } } }; }]
]) {
  test(name + 'cannot apply edge correction', (t) => {
    const tick = clock(t);
    const { player, video } = fixture(t);
    configure(player, video);
    const pos = video.currentTime;
    player._watchStartup();
    tick(1800);
    assert.equal(video.currentTime, pos);
    assert.equal(player.startupStatus().nudged, false);
  });
}

test('next segment download does not block edge correction in continuous buffer', (t) => {
  const tick = clock(t);
  const { player, video } = fixture(t);
  player.hls.inFlightFragments = { main: { state: 'FRAG_LOADING', frag: { start: 16 } } };
  player._watchStartup();
  tick(1000);
  assert.equal(video.currentTime, 10.05);
});

test('seek jump is not playback; stall timer restarts after seek', (t) => {
  const tick = clock(t);
  const { player, video } = fixture(t);
  video.currentTime = 0;
  video.seeking = true;
  player._watchStartup();
  tick(2000);
  video.currentTime = 10;
  video.seeking = false;
  video.emit('seeked');
  assert.equal(player.startupStatus().motion, null);
  tick(800);
  assert.equal(video.currentTime, 10);
  tick(200);
  assert.equal(video.currentTime, 10.05);
});

test('timeout watch leaves no timers and bypasses no watchdog', (t) => {
  const tick = clock(t);
  const { player, video } = fixture(t);
  video.seeking = true;
  player._watchStartup();
  tick(15000);
  assert.equal(player.startupStatus().reason, 'timeout');
  assert.equal(player._startupTimer, null);
  assert.equal(video.currentTime, 10);
});

test('late first fragment past deadline must not start idle timer', (t) => {
  const tick = clock(t);
  const { player } = fixture(t);
  tick(15000);
  player._watchStartup();
  assert.equal(player._startupTimer, null);
});

test('native path without seekable only observes; no HLS edge correction', (t) => {
  const tick = clock(t);
  const { player, video } = fixture(t);
  player._activePath = 'native';
  player.hls = null;
  player._rawUrl = player.current.url;
  player._watchStartup();
  tick(2000);
  assert.equal(player.startupStatus().path, 'native');
  assert.equal(player.startupStatus().nudged, false);
  assert.equal(video.currentTime, 10);
});

test('stop/destroy cancels frame callback; late frames do not pollute new load', (t) => {
  clock(t);
  const { player, video } = fixture(t);
  let frame;
  let cancelled;
  video.requestVideoFrameCallback = (fn) => { frame = fn; return 7; };
  video.cancelVideoFrameCallback = (id) => { cancelled = id; };
  player._watchStartup();
  player.stop();
  assert.equal(cancelled, 7);
  assert.equal(player._startupTimer, null);
  player._phase = { t0: Date.now() };
  frame();
  assert.equal(player._phase.frame, undefined);
});

test('frame callback, playing and progress recorded separately', (t) => {
  const tick = clock(t);
  const { player, video } = fixture(t);
  let frame;
  video.requestVideoFrameCallback = (fn) => { frame = fn; return 7; };
  video.cancelVideoFrameCallback = () => {};
  player._watchStartup();
  tick(200);
  frame();
  assert.equal(player.startupStatus().frame, 200);
  assert.equal(player.startupStatus().playing, null);
  assert.equal(player.startupStatus().motion, null);
});

test('speed badge shows English startup diagnostics before playing; cleared on reset', (t) => {
  clock(t);
  const { player } = fixture(t);
  player._watchStartup();
  const el = { innerHTML: '' };
  const badge = new NetSpeed(el, player);
  badge._render();
  assert.match(el.innerHTML, /Data 0\.0s/);
  assert.match(el.innerHTML, /Seek —/);
  assert.match(el.innerHTML, /Moving —/);
  assert.match(el.innerHTML, /Buffered, not advancing/);
  assert.doesNotMatch(el.innerHTML, /undefined|NaN|\{seconds\}/);
  player.stop();
  badge.reset();
  assert.doesNotMatch(el.innerHTML, /Buffered|Moving|Data/);
});

function nativeFixture(t) {
  const f = fixture(t);
  f.player.hls = null;
  f.player._activePath = 'native';
  f.player._rawUrl = f.player.current.url;
  f.video.seekable = ranges([[0, 30]]);
  return f;
}

for (const readyState of [2, 3, 4]) {
  test(`native HLS readyState=${readyState} stalled with buffer must not seek`, (t) => {
    const tick = clock(t);
    const { player, video } = nativeFixture(t);
    video.readyState = readyState;
    video.currentTime = 11;
    player._watchStartup();
    tick(5000);
    assert.equal(video.currentTime, 11);
    assert.equal(player.startupStatus().nudged, false);
    assert.equal(player.startupStatus().motion, null);
  });
}

for (const [name, configure] of [
  ['buffered unreported', (p, v) => { v.buffered = ranges([]); }],
  ['buffered query throws', (p, v) => { Object.defineProperty(v, 'buffered', { get() { throw Error('unsupported'); } }); }],
  ['seekable unreported', (p, v) => { v.seekable = ranges([]); }],
  ['seekable query throws', (p, v) => { Object.defineProperty(v, 'seekable', { get() { throw Error('unsupported'); } }); }],
  ['seekable excludes current position', (p, v) => { v.seekable = ranges([[10.01, 30]]); }],
  ['seekable range has hole', (p, v) => { v.seekable = ranges([[0, 10.02], [10.04, 30]]); }],
  ['insufficient seekable margin after target', (p, v) => { v.seekable = ranges([[0, 12.01]]); }],
  ['low buffer', (p, v) => { v.buffered = ranges([[10, 10.4]]); }],
  ['insufficient buffer margin after target', (p, v) => { v.buffered = ranges([[10, 12.01]]); }],
  ['playhead in buffer hole', (p, v) => { v.buffered = ranges([[0, 9], [10.01, 30]]); }],
  ['no current frame', (p, v) => { v.readyState = 1; }],
  ['paused', (p, v) => { v.paused = true; }],
  ['seeking', (p, v) => { v.seeking = true; }],
  ['ended', (p, v) => { v.ended = true; }],
  ['errored', (p, v) => { v.error = { code: 3 }; }],
  ['catch-up', (p) => { p.mode = 'catchup'; }],
  ['non-HLS media', (p) => { p._rawUrl = 'https://example.test/video.mp4'; }]
]) {
  test(`native ${name} must not guess position`, (t) => {
    const tick = clock(t);
    const { player, video } = nativeFixture(t);
    configure(player, video);
    player._watchStartup();
    tick(2000);
    assert.equal(video.currentTime, 10);
    assert.equal(player.startupStatus().nudged, false);
  });
}

test('late native first frame still observes real progress, no seek', (t) => {
  const tick = clock(t);
  const { player, video } = nativeFixture(t);
  video.readyState = 1;
  video.buffered = ranges([]);
  player._watchStartup();
  tick(3000);
  video.readyState = 2;
  video.buffered = ranges([[10, 16]]);
  video.emit('loadeddata');
  tick(2000);
  assert.equal(video.currentTime, 10);
  assert.equal(player.startupStatus().nudged, false);
  assert.equal(player.startupStatus().motion, null);
});

test('native playing does not fake start; notify UI on real progress', (t) => {
  const tick = clock(t);
  const { player, video } = nativeFixture(t);
  const states = [];
  let plays = 0;
  player.onStateChange = state => states.push(state);
  video.play = () => { plays++; return Promise.resolve(); };
  player._watchStartup();
  player._tryPlay();
  assert.equal(plays, 1);
  video.emit('playing');
  assert.deepEqual(states, ['playing']);
  assert.equal(player.startupStatus().motion, null);
  video.currentTime = 10.2;
  tick(200);
  assert.deepEqual(states, ['playing', 'startupmoving']);
  assert.equal(player.startupStatus().reason, 'moving');
  assert.equal(player._startupTimer, null);
  tick(4000);
  assert.deepEqual(states, ['playing', 'startupmoving']);
  assert.equal(video.currentTime, 10.2);
  assert.equal(player.startupStatus().nudged, false);
});

test('never write currentTime while native is stalled', (t) => {
  const tick = clock(t);
  const { player, video } = nativeFixture(t);
  let attempts = 0;
  Object.defineProperty(video, 'currentTime', { get: () => 10, set() { attempts++; throw Error('unsupported'); } });
  player._watchStartup();
  tick(5000);
  assert.equal(attempts, 0);
  assert.equal(player.startupStatus().nudged, false);
  assert.equal(player.startupStatus().motion, null);
});

test('native seek jump is not progress; keep watching, no further nudges', (t) => {
  const tick = clock(t);
  const { player, video } = nativeFixture(t);
  const states = [];
  player.onStateChange = state => states.push(state);
  player._watchStartup();
  tick(800);
  video.seeking = true;
  video.emit('seeking');
  video.currentTime = 12;
  tick(400);
  video.seeking = false;
  video.emit('seeked');
  tick(1000);
  assert.equal(video.currentTime, 12);
  assert.equal(player.startupStatus().motion, null);
  assert.deepEqual(states, []);
});

test('native direct play watches after load; stop releases watcher', (t) => {
  clock(t);
  const { player, video } = fixture(t);
  const calls = [];
  player.hls.destroy = () => calls.push('destroy');
  video.removeAttribute = () => calls.push('remove');
  video.load = () => { calls.push('load'); video.currentTime = 0; video.readyState = 0; video.error = null; };
  video.play = () => { calls.push('play'); return Promise.resolve(); };
  player.playLive({ name: 'Native', url: 'https://example.test/live.m3u8' }, 'native');
  assert.deepEqual(calls, ['destroy', 'remove', 'load', 'play']);
  assert.equal(player.startupStatus().path, 'native');
  assert.equal(player.startupStatus().data, null);
  assert.equal(player.startupStatus().fallback, null);
  assert.notEqual(player._startupTimer, null);
  player.stop();
  assert.equal(player._startupTimer, null);
  assert.equal(player.startupStatus(), null);
});

test('HLS fallback resets frame/playing/progress, cancels old callback, own native deadline', (t) => {
  const tick = clock(t);
  const { player, video } = fixture(t);
  const frames = [];
  const cancelled = [];
  video.requestVideoFrameCallback = fn => { frames.push(fn); return frames.length; };
  video.cancelVideoFrameCallback = id => cancelled.push(id);
  player._watchStartup();
  video.emit('playing');
  player._phase.frame = Date.now();
  player._phase.motion = Date.now();
  tick(9000);
  player._proxiedUrl = player.current.url;
  player._rawUrl = player.current.url;
  video.load = () => { video.currentTime = 0; video.readyState = 0; video.error = null; };
  const states = [];
  player.onStateChange = state => states.push(state);
  assert.equal(player._fallbackToNative('audio'), true);
  assert.equal(player.hls, null);
  assert.ok(cancelled.includes(1));
  frames[0]();
  video.emit('playing');
  const status = player.startupStatus();
  assert.equal(status.native, 9000);
  assert.equal(status.fallback, 'audio');
  assert.equal(status.frame, null);
  assert.equal(status.playing, null);
  assert.equal(status.motion, null);
  assert.deepEqual(states, ['nativefallback']);
  tick(2000);
  assert.notEqual(player._startupTimer, null);
  tick(13000);
  assert.equal(player._startupTimer, null);
  assert.equal(player._fallbackToNative(), false);
});

test('fallback after HLS playing still reports pre-first-frame native errors; ignores benign leftovers', (t) => {
  clock(t);
  const { player, video } = fixture(t);
  video.emit('playing');
  player._proxiedUrl = player.current.url;
  player._rawUrl = player.current.url;
  video.load = () => { video.error = null; video.readyState = 0; };
  player._fallbackToNative('media');
  const errors = [];
  player.onError = message => errors.push(message);
  video.emit('error');
  assert.equal(errors.length, 0);
  video.error = { code: 3 };
  video.emit('error');
  assert.equal(errors.length, 1);
  assert.equal(player.startupStatus().reason, 'error');
  assert.equal(player._startupTimer, null);
});

test('error and progress in same tick must not mark start success', (t) => {
  const tick = clock(t);
  const { player, video } = nativeFixture(t);
  player._watchStartup();
  video.currentTime = 10.2;
  video.error = { code: 3 };
  tick(200);
  assert.equal(player.startupStatus().reason, 'error');
  assert.equal(player.startupStatus().motion, null);
});

test('native zap cancels watcher/callback; stale callback must not pollute new channel', (t) => {
  clock(t);
  const { player, video } = nativeFixture(t);
  let frame;
  video.requestVideoFrameCallback = fn => { frame = fn; return 1; };
  video.cancelVideoFrameCallback = () => {};
  player._watchStartup();
  const oldFrame = frame;
  video.load = () => { video.readyState = 0; video.currentTime = 0; };
  player.playLive({ name: 'New', url: 'https://example.test/new.m3u8' }, 'native');
  oldFrame();
  assert.equal(player.startupStatus().frame, null);
  assert.equal(player.startupStatus().motion, null);
  assert.equal(player.current.channel.name, 'New');
});

test('diagnostics show path/reason; unreported buffer not faked as 0s', (t) => {
  clock(t);
  const { player, video } = nativeFixture(t);
  player._phase.native = Date.now();
  player._phase.fallback = 'codec';
  video.buffered = ranges([]);
  player._watchStartup();
  const el = { innerHTML: '' };
  const badge = new NetSpeed(el, player);
  badge._render();
  assert.match(el.innerHTML, /Native ← hls.js \(codec error\)/);
  assert.match(el.innerHTML, /Native buffer not reported/);
  assert.doesNotMatch(el.innerHTML, /Buffer 0|undefined|NaN/);
});

test('late HLS playlist/level/codec callbacks after fallback must not touch native', (t) => {
  clock(t);
  const { player, video } = fixture(t);
  for (const name of ['self', 'window']) {
    const old = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value: globalThis });
    t.after(() => old ? Object.defineProperty(globalThis, name, old) : delete globalThis[name]);
  }
  t.mock.method(Hls, 'isSupported', () => true);
  t.mock.method(Hls.prototype, 'attachMedia', () => {});
  t.mock.method(Hls.prototype, 'loadSource', () => {});
  const originalOn = Hls.prototype.on;
  const handlers = new Map();
  t.mock.method(Hls.prototype, 'on', function(event, callback, ...args) {
    handlers.set(event, callback);
    return originalOn.call(this, event, callback, ...args);
  });
  player._destroyHls();
  player.playLive({ name: 'HLS', url: 'https://example.test/live.m3u8' }, 'hls');
  const old = player.hls;
  player._fallbackToNative('media');
  let plays = 0;
  video.play = () => { plays++; return Promise.resolve(); };
  old.startLoad = () => assert.fail('destroyed HLS instance cannot load');
  handlers.get(Hls.Events.MANIFEST_PARSED)();
  handlers.get(Hls.Events.LEVEL_LOADED)(null, { details: { live: true, fragments: [{}] } });
  handlers.get(Hls.Events.BUFFER_CODECS)(null, { video: { codec: 'stale' } });
  handlers.get(Hls.Events.LEVEL_SWITCHED)(null, { level: 0 });
  assert.equal(plays, 0);
  assert.equal(player._phase.manifest, undefined);
  assert.notEqual(player.mediaInfo.videoCodec, 'stale');
  assert.equal(player.activePath(), 'native');
});

test('native fallback restarts watchdog, keeps total elapsed, clears old waiting timer', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const a = source.indexOf('function beginLoading(');
  const b = source.indexOf('function endLoading()', a);
  const c = source.indexOf('player.onStateChange =');
  const d = source.indexOf('\n};', c) + 3;
  const timers = new Map();
  const cleared = [];
  const shown = [];
  let id = 10;
  const context = vm.createContext({
    player: {}, zapStarting: false, zapStartAt: 1000, startWatchdog: null, stallTimer: 5,
    START_TIMEOUT_MS: 15000, startTimeoutMs: () => 15000, onStartTimeout() {}, netSpeed: { reset() {} },
    loading: value => shown.push(value),
    setTimeout: (fn, ms) => { timers.set(++id, { fn, ms }); return id; },
    clearTimeout: timer => { cleared.push(timer); timers.delete(timer); }
  });
  vm.runInContext(source.slice(a, b) + '\n' + source.slice(c, d), context);
  context.player.onStateChange('nativefallback');
  assert.equal(context.zapStarting, true);
  assert.equal(context.zapStartAt, 1000);
  assert.ok(cleared.includes(5));
  assert.equal(timers.get(context.startWatchdog).ms, 15000);
  assert.deepEqual(shown, [true]);
});

test('first native playing keeps start overlay until real progress; HLS ends on playing', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const c = source.indexOf('player.onStateChange =');
  const d = source.indexOf('\n};', c) + 3;
  const shown = [];
  const startup = [];
  let path = 'native';
  const sandbox = {
    player: {
      activePath: () => path,
      warmStatus: () => ({ ok: true }),
      startupPhases: () => null
    },
    zapStarting: true,
    zapStartAt: 1000,
    stallTimer: null,
    netSpeed: { setStartupMs: (...args) => startup.push(args) },
    rememberPlayingSource() {},
    loading: value => shown.push(value),
    endLoading: () => { sandbox.zapStarting = false; shown.push(false); },
    setTimeout() { assert.fail('startup phase must not start playing-state waiting debounce'); }
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(source.slice(c, d), context);

  context.player.onStateChange('playing');
  assert.equal(context.zapStarting, true);
  assert.deepEqual(shown, []);
  assert.equal(startup.length, 0);

  context.player.onStateChange('waiting');
  assert.deepEqual(shown, [true]);
  context.player.onStateChange('startupmoving');
  assert.equal(context.zapStarting, false);
  assert.deepEqual(shown, [true, false]);
  assert.equal(startup.length, 1);

  context.zapStarting = true;
  context.zapStartAt = 2000;
  path = 'hls';
  context.player.onStateChange('playing');
  assert.equal(context.zapStarting, false);
  assert.equal(startup.length, 2);
});

function nativeAutoFixture(t) {
  const f = nativeFixture(t);
  for (const name of ['self', 'window']) {
    const old = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value: globalThis });
    t.after(() => old ? Object.defineProperty(globalThis, name, old) : delete globalThis[name]);
  }
  t.mock.method(Hls, 'isSupported', () => true);
  t.mock.method(Hls.prototype, 'attachMedia', () => {});
  t.mock.method(Hls.prototype, 'loadSource', () => {});
  f.player._decoder = 'auto';
  f.player._proxiedUrl = f.player._rawUrl;
  f.video.removeAttribute = () => { f.video.src = ''; };
  f.video.load = () => { f.video.currentTime = 0; f.video.readyState = 0; f.video.error = null; };
  return f;
}

for (const readyState of [0, 4]) {
  test(`auto native R${readyState} timeout tries hls.js once`, (t) => {
    const tick = clock(t);
    const { player, video } = nativeAutoFixture(t);
    const states = [];
    const errors = [];
    player.onStateChange = state => states.push(state);
    player.onError = message => errors.push(message);
    player._nativeUrls = new Set([player._rawUrl]);
    player._watchStartup();
    video.readyState = readyState;
    video.emit('playing');
    assert.equal(player._playedOnce, false, 'frozen first frame cannot fake playback success');
    tick(14800);
    assert.equal(player.activePath(), 'native');
    tick(200);
    assert.equal(player.activePath(), 'hls');
    assert.ok(player.hls);
    assert.equal(player._triedNativeFallback, true);
    assert.equal(player._nativeUrls.has(player._rawUrl), false);
    assert.equal(player._phase.t0, 115000, 'new pipeline needs its own startup deadline');
    assert.equal(player._startupTimer, null);
    assert.equal(video.error, null);
    assert.equal(errors.length, 0);
    assert.equal(states.at(-1), 'hlsfallback');
    assert.equal(player._nativeStartupFailed(), false);
    assert.equal(player._fallbackToNative('codec'), false);
  });
}

for (const code of [2, 3, 4]) {
  test(`auto native first-frame error ${code} may try hls.js and clears old media error`, (t) => {
    clock(t);
    const { player, video } = nativeAutoFixture(t);
    const errors = [];
    player.onError = message => errors.push(message);
    player._watchStartup();
    video.error = { code };
    video.emit('error');
    assert.equal(player.activePath(), 'hls');
    assert.ok(player.hls);
    assert.equal(video.error, null);
    assert.equal(errors.length, 0);
    assert.equal(player._nativeReloadTimer, null);
  });
}

for (const [name, configure] of [
  ['explicit native tier', p => { p._decoder = 'native'; }],
  ['already fell back from hls.js', p => { p._triedNativeFallback = true; }],
  ['non-HLS stream', p => { p._rawUrl = 'https://example.test/live.ts'; }],
  ['MSE unavailable', () => { Hls.isSupported = () => false; }]
]) {
  test(`${name} native timeout reports once without switching decoder`, (t) => {
    const tick = clock(t);
    const { player, video } = nativeAutoFixture(t);
    configure(player);
    const errors = [];
    player.onError = message => errors.push(message);
    player._watchStartup();
    tick(15000);
    assert.equal(player.activePath(), 'native');
    assert.equal(player.hls, null);
    assert.equal(player.startupStatus().reason, 'timeout');
    assert.equal(player._startupTimer, null);
    assert.equal(video.paused, true);
    assert.equal(errors.length, 1);
    tick(15000);
    assert.equal(errors.length, 1);
  });
}

test('native reconnect without data times out to caller', (t) => {
  const tick = clock(t);
  const { player, video } = nativeAutoFixture(t);
  player._triedNativeFallback = true;
  player._startNative(player._rawUrl, 'reconnect');
  const errors = [];
  player.onError = message => errors.push(message);
  tick(15000);
  assert.equal(errors.length, 1);
  assert.equal(player.startupStatus().reason, 'timeout');
  assert.equal(video.paused, true);
});

test('catch-up native timeout does not switch HLS or reset position', (t) => {
  const tick = clock(t);
  const { player, video } = nativeAutoFixture(t);
  player.mode = 'catchup';
  const errors = [];
  player.onError = message => errors.push(message);
  player._watchStartup();
  tick(15000);
  assert.equal(player.activePath(), 'native');
  assert.equal(video.currentTime, 10);
  assert.equal(errors.length, 0);
});

test('real progress at timeout sample counts as success', (t) => {
  const tick = clock(t);
  const { player, video } = nativeAutoFixture(t);
  const errors = [];
  player.onError = message => errors.push(message);
  player._watchStartup();
  tick(9800);
  video.currentTime = 10.2;
  tick(200);
  assert.equal(player.activePath(), 'native');
  assert.equal(player._playedOnce, true);
  assert.equal(player.startupStatus().reason, 'moving');
  assert.equal(errors.length, 0);
});

test('fatal hls.js codec error after reverse fallback must still report', (t) => {
  const tick = clock(t);
  const { player, video } = nativeAutoFixture(t);
  const originalOn = Hls.prototype.on;
  let errorHandler;
  t.mock.method(Hls.prototype, 'on', function(event, callback, context) {
    if (event === Hls.Events.ERROR && context === undefined) errorHandler = callback;
    return originalOn.call(this, event, callback, context);
  });
  const errors = [];
  player.onError = message => errors.push(message);
  video.canPlayType = () => 'probably';
  player._watchStartup();
  tick(15000);
  assert.equal(player.activePath(), 'hls');
  errorHandler(null, { fatal: true, type: Hls.ErrorTypes.MEDIA_ERROR, details: 'bufferAddCodecError' });
  assert.equal(errors.length, 1);
  assert.equal(player.hls, null);
  assert.equal(player.activePath(), 'hls', 'must not fall back to native again');
  errorHandler(null, { fatal: true, details: 'bufferAddCodecError' });
  assert.equal(errors.length, 1, 'late HLS callbacks after destroy are ignored');
});

test('after native failure tells caller to switch, old watcher must not affect new channel', (t) => {
  const tick = clock(t);
  const { player, video } = nativeAutoFixture(t);
  player._decoder = 'native';
  player.onError = () => player.playLive({ name: 'Backup', url: 'https://example.test/backup.m3u8' }, 'native');
  player._watchStartup();
  tick(15000);
  assert.equal(player.current.channel.name, 'Backup');
  assert.equal(player._startup.done, false);
  video.paused = false;
  video.currentTime = 0.2;
  tick(200);
  assert.equal(player.startupStatus().reason, 'moving');
  assert.equal(player._startupTimer, null);
});

test('reverse fallback gives HLS watchdog full deadline and keeps total elapsed', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const a = source.indexOf('function beginLoading(');
  const b = source.indexOf('function endLoading()', a);
  const c = source.indexOf('player.onStateChange =');
  const d = source.indexOf('\n};', c) + 3;
  let deadline;
  const context = vm.createContext({
    player: {}, zapStarting: true, zapStartAt: 1000, startWatchdog: 5, stallTimer: 6,
    START_TIMEOUT_MS: 15000, startTimeoutMs: () => 15000, onStartTimeout() {}, netSpeed: { reset() {} },
    loading() {}, clearTimeout() {},
    setTimeout: (fn, ms) => { deadline = ms; return 7; }
  });
  vm.runInContext(source.slice(a, b) + '\n' + source.slice(c, d), context);
  context.player.onStateChange('hlsfallback');
  assert.equal(context.zapStartAt, 1000);
  assert.equal(context.zapStarting, true);
  assert.equal(context.startWatchdog, 7);
  assert.equal(deadline, 15000);
});

test('manual pause after first frame is not failure; resume keeps remaining wait', (t) => {
  const tick = clock(t);
  const { player, video } = nativeAutoFixture(t);
  const errors = [];
  player._decoder = 'native';
  player.onError = message => errors.push(message);
  player._watchStartup();
  tick(2000);
  video.paused = true;
  tick(20000);
  assert.equal(player._startup.done, false);
  assert.equal(errors.length, 0);
  video.paused = false;
  tick(12800);
  assert.equal(errors.length, 0);
  tick(200);
  assert.equal(errors.length, 1);
});

test('late error/waiting after native timeout must not re-notify or respawn spinner', (t) => {
  const tick = clock(t);
  const { player, video } = nativeAutoFixture(t);
  const errors = [];
  const states = [];
  player._decoder = 'native';
  player.onError = message => errors.push(message);
  player.onStateChange = state => states.push(state);
  player._watchStartup();
  tick(15000);
  video.error = { code: 4 };
  video.emit('error');
  video.emit('waiting');
  assert.equal(errors.length, 1);
  assert.deepEqual(states, []);
});

test('native no-data play failure stays paused and still times out', (t) => {
  const tick = clock(t);
  const { player, video } = nativeAutoFixture(t);
  player._decoder = 'native';
  video.readyState = 0;
  video.paused = true;
  const errors = [];
  player.onError = message => errors.push(message);
  player._watchStartup();
  tick(15000);
  assert.equal(errors.length, 1);
});

test('watchdog must not flag paused ready media as bad; no data still errors', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const a = source.indexOf('function onStartTimeout()');
  const b = source.indexOf('\n}', a) + 2;
  let attempts = 0;
  const context = vm.createContext({
    player: { video: { paused: true, readyState: 4, error: null } },
    startWatchdog: null, START_TIMEOUT_MS: 15000, startTimeoutMs: () => 15000,
    zapStarting: true, stallTimer: null,
    setTimeout: () => 7, clearTimeout() {}, loading() {}, toast() {}, t: key => key,
    tryFailover() { attempts++; return false; }
  });
  vm.runInContext(source.slice(a, b), context);
  context.onStartTimeout();
  assert.equal(attempts, 0);
  assert.equal(context.startWatchdog, 7);
  context.player.video.readyState = 0;
  context.onStartTimeout();
  assert.equal(attempts, 1);
  assert.equal(context.zapStarting, false);
});

test('silent hls blackscreen after loaded fragment falls back to native once', (t) => {
  const tick = clock(t);
  const { player, video } = fixture(t);
  video.canPlayType = () => 'maybe';
  video.readyState = 1; // TV reports no decodable frame, so no edge nudge
  player._proxiedUrl = player.current.url;
  player._rawUrl = player.current.url;
  player._fragMarks = 1;
  const states = [];
  player.onStateChange = state => states.push(state);
  player._watchStartup();
  tick(6900);
  assert.equal(player.activePath(), 'hls');
  assert.deepEqual(states, []);
  tick(200);
  assert.equal(player.activePath(), 'native');
  assert.deepEqual(states, ['nativefallback']);
  assert.equal(player._phase.fallback, 'black');
  assert.notEqual(player._startupTimer, null, 'native watchdog restarts');
  tick(20000);
  assert.equal(player.activePath(), 'native');
  assert.deepEqual(states, ['nativefallback'], 'no repeated fallback');
});

test('silent blackscreen watchdog waits for a loaded fragment', (t) => {
  const tick = clock(t);
  const { player, video } = fixture(t);
  video.canPlayType = () => 'maybe';
  player._proxiedUrl = player.current.url;
  player._rawUrl = player.current.url;
  player._fragMarks = 0;
  const states = [];
  player.onStateChange = state => states.push(state);
  player._watchStartup();
  tick(30000);
  assert.equal(player.activePath(), 'hls');
  assert.deepEqual(states, []);
});

test('fatal hls.js bufferAppendError falls back to native once', (t) => {
  clock(t);
  const { player, video } = fixture(t);
  video.canPlayType = () => 'maybe';
  for (const name of ['self', 'window']) {
    const old = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value: globalThis });
    t.after(() => old ? Object.defineProperty(globalThis, name, old) : delete globalThis[name]);
  }
  t.mock.method(Hls, 'isSupported', () => true);
  t.mock.method(Hls.prototype, 'attachMedia', () => {});
  t.mock.method(Hls.prototype, 'loadSource', () => {});
  const originalOn = Hls.prototype.on;
  let errorHandler;
  t.mock.method(Hls.prototype, 'on', function(event, callback, context) {
    if (event === Hls.Events.ERROR && context === undefined) errorHandler = callback;
    return originalOn.call(this, event, callback, context);
  });
  const states = [];
  player.onStateChange = state => states.push(state);
  player._destroyHls();
  player.playLive({ name: 'HLS', url: 'https://example.test/live.m3u8' }, 'hls');
  errorHandler(null, { fatal: true, type: Hls.ErrorTypes.MEDIA_ERROR, details: 'bufferAppendError' });
  assert.equal(player.activePath(), 'native');
  assert.deepEqual(states, ['nativefallback']);
  assert.equal(player._phase.fallback, 'media');
});
