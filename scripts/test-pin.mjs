// Run: node --test scripts/test-pin.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sha256Hex,
  hashPin,
  verifyPin,
  isHashedPin,
  migratePin
} from '../src/core/pin.js';

test('sha256 matches known vectors including block boundaries', () => {
  assert.equal(
    sha256Hex(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  );
  assert.equal(
    sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
  assert.equal(
    sha256Hex('a'.repeat(55)),
    '9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318'
  );
  assert.equal(
    sha256Hex('a'.repeat(56)),
    'b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a'
  );
  assert.equal(
    sha256Hex('a'.repeat(64)),
    'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb'
  );
  assert.equal(
    sha256Hex('a'.repeat(65)),
    '635361c48bb9eab14198e76ea8ab7f1a41685d6ad62aa9146d301d4f17eb0ae0'
  );
});

test('hashPin stores salt:hash, hashes are unique and verify only the original PIN', () => {
  const a = hashPin('1234');
  const b = hashPin('1234');
  assert.match(a, /^[0-9a-f]{16}:[0-9a-f]{64}$/);
  assert.notEqual(a, b, 'every migration/set uses a fresh salt');
  assert.equal(isHashedPin(a), true);
  assert.equal(isHashedPin('1234'), false);
  assert.equal(verifyPin('1234', a), true);
  assert.equal(verifyPin('4321', a), false);
  assert.equal(verifyPin('', a), false);

  
  assert.equal(verifyPin('1234', '1234'), true);
  assert.equal(verifyPin('4321', '1234'), false);
  assert.equal(verifyPin('12:34', '12:34'), true);
  assert.equal(isHashedPin('12:34'), false);
});

test('migratePin hashes plaintext once and keeps hashed/empty values untouched', () => {
  assert.equal(migratePin(''), '');
  assert.equal(migratePin(null), null);
  const plain = migratePin('1234');
  assert.equal(isHashedPin(plain), true);
  assert.equal(verifyPin('1234', plain), true);
  assert.equal(migratePin(plain), plain, 'already hashed, no double salting');
});
