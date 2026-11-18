// Run: node --test scripts/test-debug-overlay.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { DebugOverlay } from '../src/ui/DebugOverlay.js';

class FakeClassList {
  constructor() { this.set = new Set(['hidden']); }
  add(c) { this.set.add(c); }
  remove(c) { this.set.delete(c); }
  contains(c) { return this.set.has(c); }
  toggle(c, force) {
    const want = force === undefined ? !this.set.has(c) : !!force;
    if (want) this.set.add(c); else this.set.delete(c);
  }
}

function fakeEl() {
  return { classList: new FakeClassList(), innerHTML: '' };
}

test('overlay starts hidden and toggles on setVisible', () => {
  const el = fakeEl();
  const overlay = new DebugOverlay(el);
  assert.equal(overlay.isVisible(), false);
  overlay.setVisible(true);
  assert.equal(overlay.isVisible(), true);
  assert.equal(el.classList.contains('hidden'), false);
  overlay.toggle();
  assert.equal(overlay.isVisible(), false);
  assert.equal(el.classList.contains('hidden'), true);
});

test('event buffer is capped at 20 entries', () => {
  const overlay = new DebugOverlay(fakeEl());
  for (let i = 0; i < 30; i++) overlay.logEvent('frag', '#' + i + ' ok');
  assert.equal(overlay.events.length, 20);
  assert.equal(overlay.events[0].info, '#10 ok');
});

test('render shows state rows but never a stream URL', () => {
  const el = fakeEl();
  const overlay = new DebugOverlay(el);
  overlay.setVisible(true);
  overlay.render({
    path: 'hls',
    readyState: 4,
    paused: false,
    position: 12.5,
    ahead: 6.25,
    level: '0',
    bitrate: 8000000,
    audioLabel: 'German',
    subtitleLabel: '',
    videoCodec: 'avc1',
    audioCodec: 'mp4a',
    width: 1920,
    height: 1080,
    remux: true,
    fragLoadSec: 1.5
  });
  assert.match(el.innerHTML, /DEBUG/);
  assert.match(el.innerHTML, /buffer ahead<\/span><b>6\.3s/);
  assert.match(el.innerHTML, /8000 kbps/);
  assert.doesNotMatch(el.innerHTML, /https?:\/\//);
});
