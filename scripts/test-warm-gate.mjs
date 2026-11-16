                                             
                                                
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import Hls from 'hls.js';
import { Player } from '../src/player/Player.js';
import { hasSeg, pendingSeg, segBudget, segCount, setSegBudget, putSeg } from '../src/player/fragCache.js';
import { setRangeLanes, rangeLanes } from '../src/player/rangeLoad.js';
import { defaultTuning, getTuning, saveTuning, resetTuning, cycleValue, toHlsConfig } from '../src/player/tuning.js';
import { PlayerTuning } from '../src/ui/PlayerTuning.js';
import { KEY } from '../src/core/keys.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
let serial = 0;

class FakeVideo {
  constructor() {
    this.currentTime = 100;
    this.ranges = [[100, 104]];
    this.readyState = 4;
    this.paused = false;
    this.ended = false;
    this.seeking = false;
    this.error = null;
    this.playbackRate = 1;
    this.videoWidth = 0;
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
  pause() { this.paused = true; this.emit('pause'); }
  play() { this.paused = false; return Promise.resolve(); }
  load() {}
  removeAttribute() {}
  canPlayType() { return ''; }
}

function fixture(t) {
  t.mock.method(console, 'log', () => {});
  t.mock.method(globalThis, 'fetch', () => Promise.reject(new Error('tests forbid real network')));
  setSegBudget(0);
  const video = new FakeVideo();
  const player = new Player(video);
  const base = 'https://example.test/' + (++serial);
  player.current = { channel: { name: 'Test Channel' }, url: base + '/live.m3u8' };
  player._activePath = 'hls';
  player.hls = { config: { maxBufferLength: 30 }, destroy() {}, stopLoad() {}, loadSource() {} };
  const jobs = [];
  player._warmOne = (job, ctl) => {
    const d = deferred();
    ctl.signal.addEventListener('abort', () => d.reject(new Error('aborted')), { once: true });
    jobs.push({ job, signal: ctl.signal, resolve: d.resolve });
    return d.promise;
  };
  t.after(async () => { player.stop(); await flush(); });
  const queue = (n = 2, chan = base + '/next.m3u8') => {
    const urls = Array.from({ length: n }, (_, i) => base + '/seg-' + i + '.ts');
    player._queueWarm(urls, chan);
    return urls;
  };
  const ahead = (seconds, event = 'timeupdate') => {
    video.ranges = [[video.currentTime, video.currentTime + seconds]];
    video.emit(event);
  };
  return { player, video, jobs, queue, ahead, base };
}

function tuning(t, values = {}) {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const data = new Map([['iptv:hlsTuning', JSON.stringify(values)]]);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => data.set(key, value),
      removeItem: (key) => data.delete(key)
    }
  });
  t.after(() => {
    if (old) Object.defineProperty(globalThis, 'localStorage', old);
    else delete globalThis.localStorage;
  });
}

function fragment(duration, seconds, type = 'main', sn = 1) {
  return { frag: { type, sn, duration, stats: { loading: { start: 0, end: seconds * 1000 } } } };
}

test('only the playhead interval counts; no holes, no seekable', (t) => {
  const { player, video } = fixture(t);
  video.ranges = [[90, 105], [110, 180]];
  assert.equal(player._bufferAhead(), 5);
  video.currentTime = 107;
  assert.equal(player._bufferAhead(), 0);
  video.currentTime = 105;
  assert.equal(player._bufferAhead(), 0);
  video.currentTime = 110;
  assert.equal(player._bufferAhead(), 70);
  video.currentTime = NaN;
  assert.equal(player._bufferAhead(), 0);
  Object.defineProperty(video, 'buffered', { get() { throw new Error('unavailable'); } });
  assert.equal(player._bufferAhead(), 0);
});

test('no warm-up on thin buffer after first frame; 3s cannot force release', (t) => {
  const { player, video, jobs, queue, ahead } = fixture(t);
  queue();
  video.emit('playing');
  assert.equal(jobs.length, 0);
  const now = Date.now();
  t.mock.method(Date, 'now', () => now + 4000);
  ahead(4, 'progress');
  assert.equal(jobs.length, 0);
  assert.equal(player._warmHold, true);
  assert.deepEqual(player._warmThresholds(), { resume: 5, hold: 3 });
  ahead(4.99, 'progress');
  assert.equal(jobs.length, 0);
  ahead(5, 'progress');
  assert.equal(jobs.length, 1);
});

test('segment duration and download time set high/low watermarks with hysteresis', (t) => {
  const { player, video, jobs, queue, ahead } = fixture(t);
  player._recordFragLoad(fragment(6, 2));
  assert.deepEqual(player._warmThresholds(), { resume: 9, hold: 4.5 });
  queue();
  ahead(8, 'playing');
  assert.equal(jobs.length, 0);
  ahead(9);
  assert.equal(jobs.length, 1);
  ahead(7);
  assert.equal(player._warmHold, false);
  ahead(4);
  assert.equal(player._warmHold, true);
  ahead(7);
  assert.equal(player._warmHold, true);
  ahead(9);
  assert.equal(player._warmHold, false);
  assert.equal(video.paused, false);
});

test('low buffer keeps in-flight segments; resumes only at high watermark', async (t) => {
  const { player, jobs, queue, ahead } = fixture(t);
  queue();
  ahead(10, 'playing');
  assert.equal(jobs.length, 1);
  ahead(2);
  assert.equal(jobs[0].signal.aborted, false);
  jobs[0].resolve(new ArrayBuffer(8));
  await flush();
  assert.equal(jobs.length, 1);
  assert.equal(player._warmQ.length, 1);
  ahead(4);
  assert.equal(jobs.length, 1);
  ahead(5);
  assert.equal(jobs.length, 2);
});

test('after waiting, wait for playing even if progress shows high buffer', async (t) => {
  const { player, video, jobs, queue, ahead } = fixture(t);
  queue();
  ahead(10, 'playing');
  video.emit('waiting');
  assert.equal(player._warmHold, true);
  assert.equal(jobs[0].signal.aborted, false);
  jobs[0].resolve(new ArrayBuffer(8));
  await flush();
  ahead(20, 'progress');
  assert.equal(jobs.length, 1);
  video.emit('playing');
  assert.equal(jobs.length, 2);
});

test('paused/ended/seeking/error/low readyState block new tasks', (t) => {
  const { player, video, jobs, ahead } = fixture(t);
  ahead(20, 'playing');
  for (const [key, value] of [['paused', true], ['ended', true], ['seeking', true], ['error', {}], ['readyState', 2]]) {
    const old = video[key];
    video[key] = value;
    player._pumpWarm();
    assert.equal(player._warmHold, true, key);
    video[key] = old;
    video.emit('playing');
    assert.equal(player._warmHold, false, key);
  }
  assert.equal(jobs.length, 0);
});

test('seek inside buffer without waiting resumes warm-up on seeked', (t) => {
  const { player, video, ahead } = fixture(t);
  ahead(20, 'playing');
  video.seeking = true;
  video.emit('seeking');
  assert.equal(player._warmHold, true);
  video.seeking = false;
  video.emit('seeked');
  video.emit('timeupdate');
  assert.equal(player._warmHold, false);
});

test('native path does not fake buffers; prefetch reusable neighbours when visible buffer is enough', (t) => {
  const { player, video, jobs, queue, ahead } = fixture(t);
  player.hls = null;
  player._activePath = 'native';
  video.ranges = [];
  video.seekable = { length: 1, end: () => 1000 };
  queue();
  video.emit('playing');
  assert.equal(jobs.length, 0);
  ahead(9, 'progress');
  assert.equal(jobs.length, 1);
});

test('catch-up does not prefetch; speed scales margin by playable time', async (t) => {
  const { player, video, jobs, queue, ahead } = fixture(t);
  video.playbackRate = 2;
  queue();
  ahead(8, 'playing');
  assert.equal(jobs.length, 0);
  ahead(10);
  assert.equal(jobs.length, 1);
  player._abortWarm(null);
  await flush();
  player.mode = 'catchup';
  queue();
  ahead(40, 'playing');
  assert.equal(jobs.length, 1);
});

test('use main-media samples only; slow download not flushed by next-segment hit', (t) => {
  const { player } = fixture(t);
  player._recordFragLoad(fragment(6, 10));
  assert.equal(player._warmThresholds().resume, 22);
  player._recordFragLoad(fragment(1, 0.01, 'audio'));
  player._recordFragLoad(fragment(1, 0.01, 'main', 'initSegment'));
  assert.equal(player._fragLoadSec, 10);
  player._recordFragLoad(fragment(6, 0.01));
  assert.equal(player._fragLoadSec, 8);
  assert.equal(player._warmThresholds().resume, 18);
  player._abortWarm(null);
  assert.equal(player._fragLoadSec, 0);
  assert.equal(player._fragDuration, 0);
});

test('small buffer targets tolerate long segments; slow downloads do not lower the safety line', (t) => {
  const { player, queue, jobs, ahead } = fixture(t);
  player.hls.config.maxBufferLength = 10;
  player._recordFragLoad(fragment(10, 1));
  assert.equal(player._warmThresholds().resume, 8);
  player._recordFragLoad(fragment(10, 10));
  assert.equal(player._warmThresholds().resume, 22);
  queue();
  ahead(10, 'playing');
  assert.equal(jobs.length, 0);
});

test('switching to an in-flight channel keeps full segments, clears the queue, re-arms the gate', async (t) => {
  const { player, jobs, queue, ahead, base } = fixture(t);
  const chan = base + '/next.m3u8';
  const urls = queue(2, chan);
  ahead(10, 'playing');
  assert.ok(pendingSeg(urls[0]));
  const generation = player._warmGeneration;
  t.mock.method(Hls, 'isSupported', () => true);                                  
  player.playLive({ name: 'Next Channel', url: chan }, 'hls');
  assert.equal(player._warmGeneration, generation + 1);
  assert.equal(jobs[0].signal.aborted, false);
  assert.equal(player._warmHold, true);
  assert.equal(player._warmQ.length, 0);
  jobs[0].resolve(new ArrayBuffer(8));
  await flush();
  assert.equal(hasSeg(urls[0]), true);
  assert.equal(jobs.length, 1);
});

for (const decoder of ['hls', 'native']) {
  test('switching to an in-flight channel after close must cancel and release cache:' + decoder, async (t) => {
    tuning(t);
    const { player, jobs, queue, ahead, base } = fixture(t);
    const chan = base + '/next.m3u8';
    const urls = queue(2, chan);
    putSeg(base + '/cached.ts', new ArrayBuffer(8), 1);
    ahead(10, 'playing');
    saveTuning({ ...getTuning(), prefetchSegmentBytes: 0 });
    t.mock.method(Hls, 'isSupported', () => true);
    player.playLive({ name: 'Next Channel', url: chan }, decoder);
    assert.equal(jobs[0].signal.aborted, true);
    assert.equal(player._warmQ.length, 0);
    assert.equal(segBudget(), 0);
    assert.equal(segCount(), 0);
    assert.equal(player._warmHeld, 0);
    jobs[0].resolve(new ArrayBuffer(8));
    await flush();
    assert.equal(hasSeg(urls[0]), false);
    assert.equal(pendingSeg(urls[0]), false);
    assert.equal(jobs.length, 1);
  });
}

test('prefetch on but target native: do not keep in-flight segments', async (t) => {
  const { player, jobs, queue, ahead, base } = fixture(t);
  const chan = base + '/next.m3u8';
  queue(2, chan);
  ahead(10, 'playing');
  player.playLive({ name: 'Native Channel', url: chan }, 'native');
  assert.equal(jobs[0].signal.aborted, true);
  assert.equal(player._warmQ.length, 0);
  await flush();
});

test('closing prefetch does not affect the current fragParallel loader', (t) => {
  tuning(t, { prefetchSegmentBytes: 0, fragParallel: 2 });
  const { player, base } = fixture(t);
  for (const name of ['self', 'window']) {
    const old = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value: globalThis });
    t.after(() => old ? Object.defineProperty(globalThis, name, old) : delete globalThis[name]);
  }
  const lanes = rangeLanes();
  t.after(() => setRangeLanes(lanes));
  t.mock.method(Hls, 'isSupported', () => true);
  t.mock.method(Hls.prototype, 'attachMedia', () => {});
  t.mock.method(Hls.prototype, 'loadSource', () => {});
  player._destroyHls();
  player.playLive({ name: 'Current Channel', url: base + '/live.m3u8' }, 'hls');
  assert.equal(rangeLanes(), 2);
  assert.equal(player.hls.config.fLoader, Player._fragLoaderFor(player.hls.config.loader));
  assert.equal(segBudget(), 0);
  assert.equal(fetch.mock.calls.length, 0);
});

test('late completion of a cancelled task cannot clear the new controller', async (t) => {
  const { player, jobs, queue, ahead } = fixture(t);
  queue();
  ahead(10, 'playing');
  player._abortWarm(null);
  queue();
  ahead(10, 'playing');
  const ctl = player._warmCtl;
  assert.equal(jobs.length, 2);
  await flush();
  assert.equal(player._warmCtl, ctl);
  assert.equal(player._warming, true);
  assert.equal(jobs[1].signal.aborted, false);
});

test('old events and playlists after stop cannot resume prefetch', async (t) => {
  const { player, video, jobs, ahead, base } = fixture(t);
  const response = deferred();
  t.mock.method(globalThis, 'fetch', () => response.promise);
  ahead(10, 'playing');
  const pending = player.prefetch(base + '/late.m3u8');
  await flush();
  player.stop();
  response.resolve({ text: async () => '#EXTM3U\n#EXTINF:6,\n1.ts' });
  await pending;
  video.paused = false;
  ahead(30, 'playing');
  assert.equal(player._warmQ?.length || 0, 0);
  assert.equal(jobs.length, 0);
  assert.equal(player._warmHold, true);
});

test('late master stops child fetches; late child stops queuing', async (t) => {
  const { player, base, ahead } = fixture(t);
  ahead(10, 'playing');
  let responses = [deferred()];
  let calls = 0;
  t.mock.method(globalThis, 'fetch', () => responses[calls++].promise);
  const oldMaster = player.prefetch(base + '/master-old.m3u8');
  await flush();
  player._abortWarm(null);
  responses[0].resolve({ text: async () => '#EXTM3U\nchild.m3u8' });
  await oldMaster;
  assert.equal(calls, 1);
  responses = [deferred(), deferred()];
  calls = 0;
  ahead(10, 'playing');
  const oldChild = player.prefetch(base + '/master-new.m3u8');
  responses[0].resolve({ text: async () => '#EXTM3U\nchild-new.m3u8' });
  await flush();
  assert.equal(calls, 2);
  player._abortWarm(null);
  responses[1].resolve({ text: async () => '#EXTM3U\n#EXTINF:6,\n1.ts' });
  await oldChild;
  assert.equal(player._warmQ?.length || 0, 0);
});

for (const path of ['hls', 'native']) {
  test('close cancels registered but unstarted playlist tasks:' + path, async (t) => {
    tuning(t);
    const { player, ahead, jobs, base } = fixture(t);
    player._decoder = path;
    ahead(10, 'playing');
    const p = player.prefetch(base + '/next.m3u8');
    player.applyWarmTuning(saveTuning({ ...getTuning(), prefetchSegmentBytes: 0 }));
    await p;
    assert.equal(fetch.mock.calls.length, 0);
    assert.equal(jobs.length, 0);
    assert.equal(player._warmTargets.size, 0);
    assert.equal(player._warmManifests?.size || 0, 0);
  });
}

for (const kind of ['master', 'child', 'media', 'native']) {
  for (const stage of ['response', 'text']) {
    test('late playlist after close cannot read, recurse or queue:' + kind + '/' + stage, async (t) => {
      tuning(t);
      const { player, ahead, jobs, base } = fixture(t);
      const late = deferred();
      const signals = [];
      let cancelled = 0;
      player._decoder = kind === 'native' ? 'native' : 'hls';
      t.mock.method(globalThis, 'fetch', (url, options) => {
        signals.push(options.signal);
        if (kind === 'child' && url.endsWith('/next.m3u8')) {
          return Promise.resolve({ text: async () => '#EXTM3U\nchild.m3u8' });
        }
        return stage === 'response' ? late.promise : Promise.resolve({ text: () => late.promise });
      });
      ahead(10, 'playing');
      const p = player.prefetch(base + '/next.m3u8');
      player.prefetch(base + '/other.m3u8');
      await flush();
      const requests = signals.length;
      player.applyWarmTuning(saveTuning({ ...getTuning(), prefetchSegmentBytes: 0 }));
      assert.equal(signals.every((signal) => signal.aborted), true);
      late.resolve(stage === 'response' ? {
        ok: true,
        body: { cancel() { cancelled++; } },
        text() { assert.fail('late playlist after close cannot keep reading body'); }
      } : '#EXTM3U\n' + (kind === 'master' ? 'late-child.m3u8' : '#EXTINF:6,\nlate.ts'));
      await p;
      await flush();
      ahead(30, 'playing');
      assert.equal(signals.length, requests);
      assert.equal(cancelled, stage === 'response' ? (kind === 'native' ? 2 : 1) : 0);
      assert.equal(jobs.length, 0);
      assert.equal(player._warmTargets.size, 0);
      assert.equal(player._warmManifests.size, 0);
      assert.equal(player._warmQ?.length || 0, 0);
      assert.equal(segBudget(), 0);
    });
  }
}

test('quota 0 queues directly without queue, request, pending or cache', async (t) => {
  tuning(t, { prefetchSegmentBytes: 0 });
  const { player, video, jobs, queue, ahead } = fixture(t);
  const urls = queue();
  video.emit('playing');
  ahead(30, 'progress');
  await flush();
  assert.equal(player._warmQ, undefined);
  assert.equal(player._warmTargets.size, 0);
  assert.equal(player._warmHold, true);
  assert.equal(jobs.length, 0);
  assert.equal(fetch.mock.calls.length, 0);
  assert.equal(segBudget(), 0);
  for (const url of urls) {
    assert.equal(pendingSeg(url), false);
    assert.equal(hasSeg(url), false);
  }
});

for (const path of ['hls', 'native', 'remembered-native']) {
  test('prefetch off registers no neighbours or playlists:' + path, async (t) => {
    tuning(t, { prefetchSegmentBytes: 0 });
    const { player, ahead, jobs, base } = fixture(t);
    const chan = base + '/next.m3u8';
    player._decoder = path === 'native' ? 'native' : 'auto';
    if (path === 'native') player._activePath = 'native';
    if (path === 'remembered-native') player._nativeUrls = new Set([chan]);
    await player.prefetch(chan);
    ahead(30, 'playing');
    await player.prefetch(chan, true);
    await flush();
    assert.equal(fetch.mock.calls.length, 0);
    assert.equal(jobs.length, 0);
    assert.equal(player._warmTargets.size, 0);
    assert.equal(player._prefetched.size, 0);
    assert.equal(player._warmManifests?.size || 0, 0);
    assert.equal(player._warmQ, undefined);
  });
}

test('native neighbour still only fetches and dedupes the playlist, no unusable segments', async (t) => {
  const { player, jobs, base } = fixture(t);
  player._decoder = 'native';
  t.mock.method(globalThis, 'fetch', async () => ({ text: async () => '#EXTM3U\nchild.m3u8' }));
  await player.prefetch(base + '/native.m3u8');
  await player.prefetch(base + '/native.m3u8');
  assert.equal(fetch.mock.calls.length, 1);
  assert.equal(jobs.length, 0);
  assert.equal(player._warmTargets.size, 0);
});

test('close cancels in-flight segments, clears queue and cache; late success is not cached', async (t) => {
  tuning(t);
  const { player, queue, ahead, base } = fixture(t);
  const late = deferred();
  let signal;
  player._warmOne = (job, ctl) => { signal = ctl.signal; return late.promise; };
  const urls = queue();
  putSeg(base + '/cached.ts', new ArrayBuffer(8), 1);
  assert.equal(segCount(), 1);
  ahead(10, 'playing');
  assert.equal(pendingSeg(urls[0]), true);
  const current = player.current;
  const hls = player.hls;
  player.applyWarmTuning({ ...getTuning(), prefetchSegmentBytes: 0 });
  assert.equal(signal.aborted, true);
  assert.equal(player._warming, false);
  assert.equal(player._warmQ.length, 0);
  assert.equal(segBudget(), 0);
  assert.equal(segCount(), 0);
  late.resolve(new ArrayBuffer(8));
  await flush();
  ahead(30, 'playing');
  assert.equal(pendingSeg(urls[0]), false);
  assert.equal(hasSeg(urls[0]), false);
  assert.equal(fetch.mock.calls.length, 0);
  assert.equal(player.current, current);
  assert.equal(player.hls, hls);
});

test('a reopened old task cannot poison the new cache or clear its controller', async (t) => {
  tuning(t);
  const { player, queue, ahead, base } = fixture(t);
  const old = deferred();
  const next = deferred();
  let count = 0;
  player._warmOne = () => (++count === 1 ? old.promise : next.promise);
  const urls = queue(1);
  ahead(10, 'playing');
  player.applyWarmTuning(saveTuning({ ...getTuning(), prefetchSegmentBytes: 0 }));
  player.applyWarmTuning(resetTuning());
  const nextUrl = base + '/new.ts';
  player._queueWarm([nextUrl], base + '/other.m3u8');
  ahead(10, 'playing');
  const ctl = player._warmCtl;
  old.resolve(new ArrayBuffer(8));
  await flush();
  assert.equal(hasSeg(urls[0]), false);
  assert.equal(pendingSeg(urls[0]), false);
  assert.equal(player._warmCtl, ctl);
  assert.equal(player._warming, true);
  assert.equal(ctl.signal.aborted, false);
  next.resolve(new ArrayBuffer(8));
  await flush();
  assert.equal(hasSeg(nextUrl), true);
  assert.equal(count, 2);
});

test('native fallback clears prefetch and rejects late segment playlists', async (t) => {
  const { player, jobs, queue, ahead, base } = fixture(t);
  queue();
  ahead(10, 'playing');
  const response = deferred();
  t.mock.method(globalThis, 'fetch', () => response.promise);
  const pending = player.prefetch(base + '/late.m3u8');
  await flush();
  player._proxiedUrl = player.current.url;
  player._rawUrl = player.current.url;
  assert.equal(player._fallbackToNative(), true);
  assert.equal(jobs[0].signal.aborted, true);
  response.resolve({ text: async () => '#EXTM3U\n#EXTINF:6,\n1.ts' });
  await pending;
  assert.equal(player._warmQ.length, 0);
  assert.equal(player._warmHold, true);
});

test('expired prefetch tasks are dropped; stale segments are not downloaded after resume', (t) => {
  const { player, jobs, queue, ahead } = fixture(t);
  queue();
  const now = Date.now();
  t.mock.method(Date, 'now', () => now + 13000);
  ahead(10, 'playing');
  assert.equal(player._warmQ.length, 0);
  assert.equal(jobs.length, 0);
});

test('refresh stale playlist once buffer is safe; prefetch fresh segments instead of stopping forever', async (t) => {
  const { player, jobs, queue, ahead } = fixture(t);
  const oldUrls = queue();
  const now = Date.now();
  t.mock.method(Date, 'now', () => now + 13000);
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    return { text: async () => '#EXTM3U\n#EXTINF:6,\nfresh-1.ts\n#EXTINF:6,\nfresh-2.ts' };
  });
  ahead(10, 'playing');
  assert.equal(jobs.length, 0);
  await flush();
  assert.equal(requests, 1);
  assert.equal(jobs.length, 1);
  assert.equal(oldUrls.includes(jobs[0].job.url), false);
  assert.match(jobs[0].job.url, /fresh-/);
  assert.equal(player._warmHold, false);
});

test('a zapped-invalidated playlist stays out of cooldown; old cleanup cannot delete the new request', async (t) => {
  const { player, base, ahead, jobs } = fixture(t);
  ahead(10, 'playing');
  const responses = [deferred(), deferred()];
  let count = 0;
  t.mock.method(globalThis, 'fetch', () => responses[count++].promise);
  const url = base + '/same-neighbour.m3u8';
  const old = player.prefetch(url);
  await flush();
  player._abortWarm(null);
  ahead(10, 'playing');
  const next = player.prefetch(url);
  await flush();
  assert.equal(count, 2);
  const entry = player._warmManifests.get(url);
  responses[0].resolve({ text: async () => '#EXTM3U\n#EXTINF:6,\nold.ts' });
  await old;
  assert.equal(player._warmManifests.get(url), entry);
  assert.equal(player._warmQ?.length || 0, 0);
  responses[1].resolve({ text: async () => '#EXTM3U\n#EXTINF:6,\nnew.ts' });
  await next;
  assert.equal(jobs.length, 1);
  assert.match(jobs[0].job.url, /new\.ts$/);
});

test('cancelling master prefetch allows refetching root and child playlists', async (t) => {
  const { player, base, ahead, jobs } = fixture(t);
  ahead(10, 'playing');
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    requests.push(url);
    return { text: async () => url.endsWith('/master.m3u8')
      ? '#EXTM3U\nchild.m3u8'
      : '#EXTM3U\n#EXTINF:6,\n1.ts' };
  });
  await player.prefetch(base + '/master.m3u8');
  assert.equal(jobs.length, 1);
  player._abortWarm(null);
  await flush();
  ahead(10, 'playing');
  await player.prefetch(base + '/master.m3u8');
  assert.equal(requests.length, 4);
  assert.equal(jobs.length, 2);
});

test('diagnostics include buffer, path and in-flight owner; repeated waiting does not spam logs', (t) => {
  const { player, video, ahead } = fixture(t);
  player.current.url = 'https://example.test/live?token=do-not-log';
  ahead(4, 'playing');
  video.emit('waiting');
  video.emit('waiting');
  const lines = console.log.mock.calls.map((call) => call.arguments[0]).filter((line) => line.startsWith('[buffer] '));
  const records = lines.map((line) => JSON.parse(line.slice(9)));
  assert.equal(records.filter((r) => r.event === 'waiting').length, 1);
  assert.equal(records[0].ahead, 4);
  assert.equal(records[0].path, 'hls');
  assert.equal(records[0].warm, 'none');
  assert.equal(lines.join('').includes('do-not-log'), false);
});

test('legacy storage defaults, invalid tier validation, new params not passed to hls.js', (t) => {
  tuning(t, { liveSyncDuration: 30, prefetchStartBuffer: -1, prefetchHoldBuffer: 100, prefetchAdaptive: 'off' });
  const tune = getTuning();
  assert.equal(tune.liveSyncDuration, 30);
  assert.equal(tune.prefetchStartBuffer, 5);
  assert.equal(tune.prefetchHoldBuffer, 3);
  assert.equal(tune.prefetchAdaptive, true);
  const config = toHlsConfig(tune);
  for (const key of ['prefetchStartBuffer', 'prefetchHoldBuffer', 'prefetchAdaptive']) assert.equal(key in config, false);
});

test('pause margin stays below start margin; adjust, read, save and default restore agree', (t) => {
  tuning(t);
  const saved = saveTuning({ ...defaultTuning(), prefetchStartBuffer: 2, prefetchHoldBuffer: 10, prefetchAdaptive: false });
  assert.equal(saved.prefetchHoldBuffer, 1);
  assert.deepEqual(getTuning(), saved);
  assert.equal(cycleValue('prefetchHoldBuffer', 1, 1, saved), 1);
  const larger = saveTuning({ ...saved, prefetchStartBuffer: 5, prefetchHoldBuffer: 3 });
  assert.equal(cycleValue('prefetchHoldBuffer', 3, 1, larger), 1);
  assert.equal(cycleValue('prefetchHoldBuffer', 1, -1, larger), 3);
  assert.deepEqual(resetTuning(), defaultTuning());
  assert.deepEqual(getTuning(), defaultTuning());
});

test('disabling adaptive prefetches custom thresholds immediately without restart; stalls still win', (t) => {
  tuning(t);
  const { player, video, jobs, queue, ahead } = fixture(t);
  player._recordFragLoad(fragment(6, 4));
  queue();
  ahead(5, 'playing');
  assert.equal(jobs.length, 0);
  const current = player.current;
  const hls = player.hls;
  player.applyWarmTuning(saveTuning({ ...getTuning(), prefetchAdaptive: false }));
  assert.equal(jobs.length, 1);
  assert.deepEqual(player._warmThresholds(), { resume: 5, hold: 3 });
  assert.deepEqual(player.getWarmBufferStatus(), { resume: 5, hold: 3, ahead: 5 });
  assert.equal(player.current, current);
  assert.equal(player.hls, hls);
  video.emit('waiting');
  player.applyWarmTuning(saveTuning({ ...getTuning(), prefetchStartBuffer: 2, prefetchHoldBuffer: 1 }));
  assert.equal(player._warmHold, true);
  assert.equal(jobs[0].signal.aborted, false);
  player.applyWarmTuning(saveTuning({ ...getTuning(), prefetchAdaptive: true }));
  assert.equal(player._warmThresholds().resume, 10);
});

test('panel visibility, focus, instant params and close-replay stay separate', (t) => {
  tuning(t, { prefetchSegmentBytes: 0 });
  const classes = new Set(['hidden']);
  const el = {
    addEventListener() {},
    classList: { add: (s) => classes.add(s), remove: (s) => classes.delete(s), contains: (s) => classes.has(s) }
  };
  const panel = new PlayerTuning(el);
  panel.render = () => {};
  t.after(() => panel.close());
  let warmChanges = 0;
  let restarts = 0;
  panel.onWarmChange = () => warmChanges++;
  panel.onApply = () => restarts++;
  panel.open('hls');
  assert.equal(panel._specs().filter((s) => s.warm).length, 0);
  panel.focusIdx = panel._specs().findIndex((s) => s.key === 'prefetchSegmentBytes');
  panel.handleKey(KEY.RIGHT);
  assert.equal(panel._specs().filter((s) => s.warm).length, 3);
  assert.equal(panel._specs()[panel.focusIdx].key, 'prefetchSegmentBytes');
  panel.close();
  assert.equal(restarts, 1);
  assert.equal(panel._warmTimer, null);
  panel.open('hls');
  panel.focusIdx = panel._specs().findIndex((s) => s.key === 'prefetchStartBuffer');
  panel.handleKey(KEY.LEFT);
  assert.equal(panel.tuning.prefetchStartBuffer, 3);
  assert.equal(panel.tuning.prefetchHoldBuffer, 2);
  assert.equal(warmChanges, 1);
  panel.close();
  assert.equal(restarts, 1);
  panel.open('hls');
  assert.equal(panel.tuning.prefetchStartBuffer, 3);
  panel.focusIdx = panel._specs().length;
  panel.handleKey(KEY.OK);
  assert.equal(panel.focusIdx, panel._specs().length);
  assert.deepEqual(panel.tuning, defaultTuning());
  assert.equal(warmChanges, 2);
  panel.close();
  assert.equal(restarts, 2);
});

test('restoring neighbour buffers alone does not replay; settings survive hide and re-enable', (t) => {
  tuning(t, { prefetchStartBuffer: 3, prefetchHoldBuffer: 2, prefetchAdaptive: false });
  const classes = new Set(['hidden']);
  const panel = new PlayerTuning({
    addEventListener() {},
    classList: { add: (s) => classes.add(s), remove: (s) => classes.delete(s), contains: (s) => classes.has(s) }
  });
  panel.render = () => {};
  t.after(() => panel.close());
  let restarts = 0;
  panel.onApply = () => restarts++;
  panel.open('hls');
  const custom = { ...panel.tuning, prefetchSegmentBytes: 0 };
  panel.tuning = saveTuning(custom);
  assert.equal(panel._specs().filter((s) => s.warm).length, 0);
  panel.tuning = saveTuning({ ...panel.tuning, prefetchSegmentBytes: 8388608 });
  assert.equal(panel.tuning.prefetchStartBuffer, 3);
  panel.focusIdx = panel._specs().length;
  panel.handleKey(KEY.OK);
  panel.close();
  assert.equal(restarts, 0);
  assert.deepEqual(getTuning(), defaultTuning());
});

test('no playlist before buffer is ready; first release uses the newest segment', async (t) => {
  const { player, ahead, jobs, base } = fixture(t);
  let revision = 'early';
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    return { text: async () => '#EXTM3U\n#EXTINF:6,\n' + revision + '.ts' };
  });
  await player.prefetch(base + '/next.m3u8');
  assert.equal(requests, 0);
  revision = 'fresh';
  ahead(10, 'playing');
  await flush();
  assert.equal(requests, 1);
  assert.match(jobs[0].job.url, /fresh\.ts$/);
});

test('live periodic refetch downloads only new segments; no refresh while waiting; fresh playlist after recovery', async (t) => {
  const { player, ahead, jobs, video, base } = fixture(t);
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  let first = 0;
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    return { text: async () => '#EXTM3U\n' + Array.from({ length: 5 }, (_, i) => '#EXTINF:6,\n' + (first + i) + '.ts').join('\n') };
  });
  await player.prefetch(base + '/next.m3u8');
  ahead(10, 'playing');
  await flush();
  jobs[0].resolve(new ArrayBuffer(4));
  await flush();
  jobs[1].resolve(new ArrayBuffer(4));
  await flush();
  assert.equal(jobs.length, 2);
  now += 7999;
  ahead(10);
  await flush();
  assert.equal(requests, 1);
  now++;
  ahead(10);
  await flush();
  assert.equal(requests, 2);
  assert.equal(jobs.length, 2);
  assert.equal(player._warmQ.length, 0);
  assert.equal(player._noteOf(base + '/next.m3u8'), 'k');
  first++;
  now += 8000;
  ahead(10);
  await flush();
  assert.equal(requests, 3);
  assert.equal(jobs.length, 3);
  assert.match(jobs[2].job.url, /4\.ts$/);
  jobs[2].resolve(new ArrayBuffer(4));
  await flush();
  video.emit('waiting');
  first++;
  now += 32000;
  ahead(20, 'progress');
  await flush();
  assert.equal(requests, 3);
  ahead(20, 'playing');
  await flush();
  assert.equal(requests, 4);
  assert.match(jobs[3].job.url, /4\.ts$/);
});

test('two neighbours are fetched in registration order; segments alternate direction', async (t) => {
  const { player, ahead, jobs, base } = fixture(t);
  const first = deferred();
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(url);
    if (url.endsWith('/a.m3u8')) return first.promise;
    return { text: async () => '#EXTM3U\n#EXTINF:6,\n' + (url.includes('a-child') ? 'a' : 'b') + '.ts' };
  });
  ahead(10, 'playing');
  const a = player.prefetch(base + '/a.m3u8');
  const b = player.prefetch(base + '/b.m3u8');
  await flush();
  assert.deepEqual(calls, [base + '/a.m3u8']);
  first.resolve({ text: async () => '#EXTM3U\na-child.m3u8' });
  await Promise.all([a, b]);
  assert.deepEqual(calls, [base + '/a.m3u8', base + '/a-child.m3u8', base + '/b.m3u8']);
  assert.match(jobs[0].job.url, /a\.ts$/);
  jobs[0].resolve(new ArrayBuffer(4));
  await flush();
  assert.match(jobs[1].job.url, /b\.ts$/);
});

test('rolling playlist requests are cancelled on stop; no later neighbours start', async (t) => {
  const { player, ahead, jobs, base } = fixture(t);
  const signals = [];
  t.mock.method(globalThis, 'fetch', (url, options) => new Promise((resolve, reject) => {
    signals.push(options.signal);
    options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }));
  ahead(10, 'playing');
  const a = player.prefetch(base + '/a.m3u8');
  player.prefetch(base + '/b.m3u8');
  await flush();
  player.stop();
  await a;
  assert.equal(signals.length, 1);
  assert.equal(signals[0].aborted, true);
  assert.equal(player._warmTargets.size, 0);
  assert.equal(jobs.length, 0);
});

test('prefetch off means zero requests; progress and force refresh cannot connect', async (t) => {
  tuning(t, { prefetchSegmentBytes: 0 });
  const { player, ahead, jobs, base } = fixture(t);
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  await player.prefetch(base + '/next.m3u8');
  ahead(10, 'playing');
  await flush();
  assert.equal(fetch.mock.calls.length, 0);
  now += 60000;
  ahead(20);
  await player.prefetch(base + '/next.m3u8', true);
  await flush();
  assert.equal(fetch.mock.calls.length, 0);
  assert.equal(jobs.length, 0);
  assert.equal(player._warmTargets.size, 0);
  assert.equal(player._warmQ, undefined);
});

test('fatal error destroys the failed instance before backup; old callback cannot destroy the new one', (t) => {
  const { player, base } = fixture(t);
  for (const name of ['self', 'window']) {
    const old = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value: globalThis });
    t.after(() => old ? Object.defineProperty(globalThis, name, old) : delete globalThis[name]);
  }
  t.mock.method(Hls, 'isSupported', () => true);
  t.mock.method(Hls.prototype, 'attachMedia', () => {});
  t.mock.method(Hls.prototype, 'loadSource', () => {});
  const originalOn = Hls.prototype.on;
  let handler;
  t.mock.method(Hls.prototype, 'on', function(event, callback, ...args) {
    if (event === Hls.Events.ERROR) handler = callback;
    return originalOn.call(this, event, callback, ...args);
  });
  player._destroyHls();
  for (const type of [Hls.ErrorTypes.NETWORK_ERROR, Hls.ErrorTypes.MEDIA_ERROR, 'other']) {
    player.playLive({ name: 'Primary', url: base + '/primary.m3u8' }, 'hls');
    const old = player.hls;
    const oldHandler = handler;
    player._netRetries = player._mediaRetries = 3;
    let callbacks = 0;
    player.onError = () => {
      callbacks++;
      assert.equal(player.hls, null);
      player.playLive({ name: 'Backup', url: base + '/backup.m3u8' }, 'hls');
    };
    const error = { fatal: true, type, details: 'controlled' };
    oldHandler(Hls.Events.ERROR, error);
    const backup = player.hls;
    assert.ok(backup && backup !== old);
    assert.equal(player.current.channel.name, 'Backup');
    oldHandler(Hls.Events.ERROR, error);
    assert.equal(player.hls, backup);
    assert.equal(callbacks, 1);
  }
});

test('a cancelled range prefetch does not fall back to a whole segment; cancellation reason is kept', async (t) => {
  const { player, base, ahead } = fixture(t);
  delete player._warmOne;
  const old = rangeLanes();
  setRangeLanes(2);
  t.after(() => setRangeLanes(old));
  let requests = 0;
  t.mock.method(globalThis, 'fetch', () => {
    requests++;
    return new Promise(() => {});
  });
  player._warmWhole = () => assert.fail('no whole-segment fallback after cancel');
  const chan = base + '/next.m3u8';
  player._queueWarm([base + '/range.ts'], chan);
  ahead(10, 'playing');
  assert.equal(requests, 1);
  player._abortWarm(null);
  await flush();
  assert.equal(requests, 1);
  assert.equal(player._noteOf(chan), 'a');
  assert.equal(pendingSeg(base + '/range.ts'), false);
});

test('save-close cancels background prefetch on progress even before replay', async (t) => {
  tuning(t);
  const { player, jobs, queue, ahead } = fixture(t);
  const urls = queue();
  ahead(10, 'playing');
  saveTuning({ ...getTuning(), prefetchSegmentBytes: 0 });
  ahead(30, 'progress');
  assert.equal(jobs[0].signal.aborted, true);
  assert.equal(player._warmQ.length, 0);
  assert.equal(segBudget(), 0);
  await flush();
  assert.equal(pendingSeg(urls[0]), false);
  assert.equal(jobs.length, 1);
});

test('after save-close, a late range probe must not fall back to a whole request', async (t) => {
  tuning(t);
  const { player, base, ahead } = fixture(t);
  delete player._warmOne;
  const old = rangeLanes();
  setRangeLanes(2);
  t.after(() => setRangeLanes(old));
  const late = deferred();
  let fallback = 0;
  t.mock.method(globalThis, 'fetch', () => late.promise);
  player._warmWhole = async () => { fallback++; return new ArrayBuffer(8); };
  const url = base + '/range.ts';
  player._queueWarm([url], base + '/next.m3u8');
  ahead(10, 'playing');
  saveTuning({ ...getTuning(), prefetchSegmentBytes: 0 });
  late.resolve(new Response(new Uint8Array(8), { status: 200 }));
  await flush();
  assert.equal(fallback, 0);
  assert.equal(fetch.mock.calls.length, 1);
  assert.equal(hasSeg(url), false);
  assert.equal(pendingSeg(url), false);
  assert.equal(segBudget(), 0);
});

test('late whole response after close cannot keep reading body', async (t) => {
  tuning(t);
  const { player, base } = fixture(t);
  const late = deferred();
  let cancelled = 0;
  t.mock.method(globalThis, 'fetch', () => late.promise);
  const p = player._warmWhole({ url: base + '/late.ts', chan: base }, new AbortController(), 32);
  const rejection = assert.rejects(p, /aborted/);
  saveTuning({ ...getTuning(), prefetchSegmentBytes: 0 });
  late.resolve({
    ok: true,
    body: {
      cancel() { cancelled++; },
      getReader() { assert.fail('cannot keep reading segment response after close'); }
    }
  });
  await rejection;
  assert.equal(cancelled, 1);
});

test('save-close during a whole read stops on the next chunk and caches nothing', async (t) => {
  tuning(t);
  const { player, base, ahead } = fixture(t);
  delete player._warmOne;
  const old = rangeLanes();
  setRangeLanes(1);
  t.after(() => setRangeLanes(old));
  let stream;
  let cancelled = 0;
  const body = new ReadableStream({
    start(c) { stream = c; c.enqueue(new Uint8Array(8)); },
    cancel() { cancelled++; }
  });
  t.mock.method(globalThis, 'fetch', async () => new Response(body));
  const url = base + '/stream.ts';
  player._queueWarm([url], base + '/next.m3u8');
  ahead(10, 'playing');
  await flush();
  saveTuning({ ...getTuning(), prefetchSegmentBytes: 0 });
  stream.enqueue(new Uint8Array(8));
  await flush();
  assert.equal(cancelled, 1);
  assert.equal(body.locked, false);
  assert.equal(fetch.mock.calls.length, 1);
  assert.equal(hasSeg(url), false);
  assert.equal(pendingSeg(url), false);
  assert.equal(segBudget(), 0);
});

test('whole prefetch without reader rejects unbounded reads', async (t) => {
  const { player, base } = fixture(t);
  let cancelled = 0;
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    headers: new Headers({ 'content-length': '1' }),
    body: { cancel() { cancelled++; return Promise.resolve(); } },
    arrayBuffer() { assert.fail('do not trust the declared length for unbounded reads'); }
  }));
  const job = { url: base + '/no-reader.ts', chan: base + '/next.m3u8' };
  assert.equal(await player._warmWhole(job, new AbortController(), 16), null);
  assert.equal(cancelled, 1);
});

test('whole prefetch enforces the capacity cap per chunk and releases the read lock', async (t) => {
  const { player, base } = fixture(t);
  let cancelled = 0;
  let body;
  t.mock.method(globalThis, 'fetch', async () => {
    body = new ReadableStream({
      start(c) { c.enqueue(new Uint8Array(8)); c.enqueue(new Uint8Array(12)); },
      cancel() { cancelled++; }
    });
    return new Response(body, { headers: { 'content-length': '1' } });
  });
  const job = { url: base + '/large.ts', chan: base + '/next.m3u8' };
  assert.equal(await player._warmWhole(job, new AbortController(), 16), null);
  assert.equal(cancelled, 1);
  assert.equal(body.locked, false);
});

test('a cancelled whole read cannot cache partial bytes as complete', async (t) => {
  const { player, base } = fixture(t);
  const ctl = new AbortController();
  let cancelled = 0;
  const body = new ReadableStream({
    start(c) { c.enqueue(new Uint8Array(8)); },
    cancel() { cancelled++; }
  });
  t.mock.method(globalThis, 'fetch', async () => new Response(body));
  const p = player._warmWhole({ url: base + '/slow.ts', chan: base }, ctl, 32);
  const rejection = assert.rejects(p, /aborted/);
  await flush();
  ctl.abort();
  await rejection;
  assert.equal(cancelled, 1);
  assert.equal(body.locked, false);
});

test('after stop, a late playlist response is cancelled immediately', async (t) => {
  const { player, base, ahead } = fixture(t);
  const d = deferred();
  let cancelled = 0;
  t.mock.method(globalThis, 'fetch', () => d.promise);
  ahead(10, 'playing');
  const p = player.prefetch(base + '/next.m3u8');
  await flush();
  player.stop();
  d.resolve({
    ok: true,
    body: { cancel() { cancelled++; } },
    text() { assert.fail('late playlist no longer reads body'); }
  });
  await p;
  assert.equal(cancelled, 1);
});

test('VOD playlist is prefetched once and not refreshed with the live clock', async (t) => {
  const { player, base, ahead, jobs } = fixture(t);
  let now = Date.now();
  let requests = 0;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    return { text: async () => '#EXTM3U\n#EXTINF:6,\none.ts\n#EXT-X-ENDLIST' };
  });
  ahead(10, 'playing');
  await player.prefetch(base + '/vod.m3u8');
  jobs[0].resolve(new ArrayBuffer(4));
  await flush();
  now += 60000;
  ahead(20);
  await flush();
  assert.equal(requests, 1);
  assert.equal(jobs.length, 1);
});

test('main registers neighbours by zap direction only and keeps no serial callbacks', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /firePrefetch|PREFETCH_AFTER_START_MS|PREFETCH_FALLBACK_MS|openWarmGate/);
  const start = source.indexOf('function schedulePrefetch()');
  const end = source.indexOf('let lastZapDir', start);
  assert.ok(start >= 0 && end > start);
  const channels = [0, 1, 2].map((n) => ({ key: String(n), name: String(n), url: String(n) }));
  const first = deferred();
  const calls = [];
  const player = {
    current: {},
    holdWarm() {},
    prefetch: (url) => { calls.push(url); return first.promise; }
  };
  const context = vm.createContext({
    player, app: { current: channels[1], zapMode: 'all' }, zapOrder: () => channels,
    zapList: () => channels, lastZapDir: 1, console: { log() {} }
  });
  vm.runInContext(source.slice(start, end), context);
  context.schedulePrefetch();
  assert.deepEqual(calls, ['2', '0']);
  player.current = {};
  first.resolve();
  await flush();
  assert.deepEqual(calls, ['2', '0']);
  calls.length = 0;
  context.lastZapDir = -1;
  context.schedulePrefetch();
  assert.deepEqual(calls, ['0', '2']);
});

test('main fav zapping loops favourites and passes zapMode to playLive', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  const start = source.indexOf('let lastZapDir');
  const end = source.indexOf('function switchSource', start);
  assert.ok(start >= 0 && end > start);
  const channels = [
    { key: 'A0', group: 'A' },
    { key: 'A1', group: 'A' },
    { key: 'B2', group: 'B' }
  ];
  const favs = new Set(['A0', 'B2']);
  let favVer = 1;
  const calls = [];
  const app = { channels, current: channels[0], zapMode: 'fav', groupLockVersion: 0 };
  const context = vm.createContext({
    app,
    isFavorite: (key) => favs.has(key),
    favVersion: () => favVer,
    isGroupUnlocked: () => true,
    playLive: (ch, delay, mode) => {
      app.current = ch;                       
      calls.push({ key: ch.key, delay, mode });
    },
    showGroupHint: () => {},
    clearTimeout() {},
    setTimeout: () => 1,
    $: () => ({ innerHTML: '', classList: { remove() {} } }),
    t: (key) => key,
    esc: (value) => value,
    groupLabel: (value) => value
  });
  vm.runInContext(source.slice(start, end), context);

  context.switchByOffset(1);                  
  context.switchByOffset(1);                 
  assert.deepEqual(
    calls.map((c) => c.key),
    ['B2', 'A0']
  );
  assert.deepEqual(
    calls.map((c) => c.mode),
    ['fav', 'fav'],
    'fav context is not reset by playLive defaults'
  );

  favs.clear();
  favVer++;
  app.current = channels[1];
  app.zapMode = 'fav';
  calls.length = 0;
  context.switchByOffset(1);                     
  assert.equal(app.zapMode, 'all');
  assert.equal(calls[0].key, 'B2');
  assert.equal(calls[0].mode, 'all');
});
