// Run: node --test scripts/test-log-redaction.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { redactUrl } from '../src/core/util.js';

test('redactUrl strips query and fragment but keeps the playable path', () => {
  assert.equal(
    redactUrl('https://gw.example/live/12345/index.m3u8?token=secret&accountinfo=x%2Fy#frag'),
    'https://gw.example/live/12345/index.m3u8'
  );
  assert.equal(redactUrl('http://user:pass@host:8080/a/b.ts?sign=abc'), 'http://user:pass@host:8080/a/b.ts');
});

test('redactUrl tolerates relative/invalid values and nullish input', () => {
  assert.equal(redactUrl('/relative/path.m3u8?token=x'), '/relative/path.m3u8');
  assert.equal(redactUrl('not a url?token=x'), 'not a url');
  assert.equal(redactUrl(''), '');
  assert.equal(redactUrl(null), '');
  assert.equal(redactUrl(undefined), '');
});
