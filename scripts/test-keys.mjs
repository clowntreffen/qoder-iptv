// Run: node --test scripts/test-keys.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { KEY, digitOf, createOkPress } from '../src/core/keys.js';

test('digitOf maps number keys only', () => {
  assert.equal(digitOf(KEY.NUM_0), 0);
  assert.equal(digitOf(57), 9);
  assert.equal(digitOf(KEY.OK), null);
});

test('short press fires short action immediately', () => {
  let short = 0;
  let long = 0;
  const press = createOkPress({ shortAction: () => short++, longAction: () => long++ });
  press.press();
  press.release();
  assert.equal(short, 1);
  assert.equal(long, 0);
});

test('holding the button fires the long action once', () => {
  let short = 0;
  let long = 0;
  const press = createOkPress({ shortAction: () => short++, longAction: () => long++ });
  press.press();
  press.press();
  press.press();
  assert.equal(short, 1);
  assert.equal(long, 1);
});

test('a second short press after a release works again', () => {
  let short = 0;
  const press = createOkPress({ shortAction: () => short++, longAction: () => {} });
  press.press();
  press.release();
  press.press();
  press.release();
  assert.equal(short, 2);
});
