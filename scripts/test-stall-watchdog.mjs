import test from 'node:test';
import assert from 'node:assert/strict';
import { StallWatchdog } from '../src/core/stallWatchdog.js';

function fixture(overrides = {}) {
  let now = 0;
  let id = 0;
  const timers = new Map();
  const stalls = [];
  let position = 10;
  let active = true;
  const watchdog = new StallWatchdog({
    now: () => now,
    setTimeoutFn: (fn, ms) => {
      timers.set(++id, { fn, at: now + ms });
      return id;
    },
    clearTimeoutFn: (timer) => timers.delete(timer),
    getPosition: () => position,
    isActive: () => active,
    onStall: () => stalls.push(now),
    ...overrides
  });
  const advance = (ms) => {
    now += ms;
    for (const [timer, item] of [...timers]) {
      if (item.at <= now) {
        timers.delete(timer);
        item.fn();
      }
    }
  };
  return {
    watchdog, stalls, advance,
    setPosition: (n) => { position = n; },
    setActive: (n) => { active = n; },
    timers
  };
}

test('stall watchdog fires only after the timeout without media progress', () => {
  const f = fixture();
  assert.equal(f.watchdog.waiting(), true);
  f.advance(14999);
  assert.deepEqual(f.stalls, []);
  f.advance(1);
  assert.deepEqual(f.stalls, [15000]);
});

test('media progress, stop and inactive playback cancel the pending stall', () => {
  const f = fixture();
  f.watchdog.waiting();
  f.setPosition(10.2);
  f.advance(15000);
  assert.deepEqual(f.stalls, []);

  f.setPosition(10.2);
  f.watchdog.waiting();
  f.watchdog.stop();
  f.advance(15000);
  assert.deepEqual(f.stalls, []);

  f.setActive(false);
  assert.equal(f.watchdog.waiting(), false);
  f.advance(15000);
  assert.deepEqual(f.stalls, []);
});

test('stall callback enters cooldown and reset clears it', () => {
  const f = fixture();
  f.watchdog.waiting();
  f.advance(15000);
  assert.deepEqual(f.stalls, [15000]);
  assert.equal(f.watchdog.cooling(), true);
  f.watchdog.stop();
  assert.equal(f.watchdog.waiting(), false);
  f.advance(30000);
  assert.equal(f.watchdog.cooling(), false);
  assert.equal(f.watchdog.waiting(), true);
  f.watchdog.stop();
  f.setPosition(11);
  f.watchdog.waiting();
  f.watchdog.reset();
  f.advance(15000);
  assert.equal(f.stalls.length, 1);
});
