// Run: node --test scripts/test-catchup-resume.mjs
// 回看断点续播：位置持久化（内存 localStorage）+ 续播提示的焦点/回调行为。
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

const { getResumePosition, setResumePosition, removeResumePosition } = await import('../src/core/storage.js');
const { ResumePrompt } = await import('../src/ui/ResumePrompt.js');
const { KEY } = await import('../src/core/keys.js');

class FakeClassList {
  constructor() { this.set = new Set(); }
  add(c) { this.set.add(c); }
  remove(c) { this.set.delete(c); }
  contains(c) { return this.set.has(c); }
  toggle(c, force) {
    const want = force === undefined ? !this.set.has(c) : !!force;
    if (want) this.set.add(c); else this.set.delete(c);
  }
}

class FakeEl {
  constructor() {
    this.classList = new FakeClassList();
    this.innerHTML = '';
    this.dataset = {};
    this._listeners = {};
  }
  set innerHTML(html) { this._html = html; }
  get innerHTML() { return this._html || ''; }
  addEventListener(type, fn) { this._listeners[type] = fn; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

// ---- 持久化 ----

test('resume position: default 0, set/get/remove', () => {
  assert.equal(getResumePosition('ch1'), 0);
  setResumePosition('ch1', 125);
  assert.equal(getResumePosition('ch1'), 125);
  removeResumePosition('ch1');
  assert.equal(getResumePosition('ch1'), 0);
});

test('resume position: invalid values do not persist', () => {
  setResumePosition('k', -1);
  setResumePosition('k', NaN);
  setResumePosition('k', Infinity);
  setResumePosition('k', 1.9);
  assert.equal(getResumePosition('k'), 1);
  setResumePosition('k', 0);
  assert.equal(getResumePosition('k'), 0);
  assert.equal(localStorage.getItem('iptv:resume'), '{}');
});

test('resume position: cap evicts oldest', () => {
  for (let i = 0; i < 205; i++) setResumePosition('cap' + i, i + 1);
  const map = JSON.parse(localStorage.getItem('iptv:resume'));
  assert.equal(Object.keys(map).length, 200);
  assert.equal(map.cap0, undefined);
  assert.equal(map.cap204, 205);
});

test('resume position: corrupt storage falls back to 0', () => {
  localStorage.setItem('iptv:resume', 'not-json');
  assert.equal(getResumePosition('ch1'), 0);
  localStorage.setItem('iptv:resume', '[1,2]');
  assert.equal(getResumePosition('ch1'), 0);
});

// ---- 提示行为 ----

function focusedAction(html) {
  const m = html.match(/data-action="([^"]+)"[^>]*class="[^"]*focused/);
  if (m) return m[1];
  const m2 = html.match(/class="[^"]*focused[^"]*"[^>]*data-action="([^"]+)"/);
  return m2 ? m2[1] : null;
}

test('prompt: show renders three actions, OK activates resume by default', () => {
  const el = new FakeEl();
  const p = new ResumePrompt(el);
  let resumed = 0;
  p.show({ title: 'T', position: 95, onResume: () => resumed++ });
  assert.equal(p.isOpen(), true);
  assert.match(el.innerHTML, /data-action="resume"/);
  assert.match(el.innerHTML, /data-action="start-over"/);
  assert.match(el.innerHTML, /data-action="cancel"/);
  assert.equal(focusedAction(el.innerHTML), 'resume');
  p.handleKey(KEY.OK);
  assert.equal(resumed, 1);
  assert.equal(p.isOpen(), false);
});

test('prompt: left/right move focus and wrap, OK follows focus', () => {
  const el = new FakeEl();
  const p = new ResumePrompt(el);
  const calls = [];
  p.show({ title: 'T', position: 10, onResume: () => calls.push('resume'), onStartOver: () => calls.push('start'), onCancel: () => calls.push('cancel') });
  p.handleKey(KEY.RIGHT);
  assert.equal(focusedAction(el.innerHTML), 'start-over');
  p.handleKey(KEY.OK);
  assert.deepEqual(calls, ['start']);

  p.show({ title: 'T', position: 10, onResume: () => calls.push('resume'), onStartOver: () => calls.push('start'), onCancel: () => calls.push('cancel') });
  p.handleKey(KEY.LEFT);
  assert.equal(focusedAction(el.innerHTML), 'cancel');
  p.handleKey(KEY.OK);
  assert.deepEqual(calls, ['start', 'cancel']);
});

test('prompt: BACK cancels and clears handlers', () => {
  const el = new FakeEl();
  const p = new ResumePrompt(el);
  let cancelled = 0;
  p.show({ title: 'T', position: 5, onCancel: () => cancelled++ });
  p.handleKey(KEY.BACK);
  assert.equal(cancelled, 1);
  assert.equal(p.isOpen(), false);
  assert.equal(p.onResume, null);
  assert.equal(p.onStartOver, null);
  assert.equal(p.onCancel, null);
});

test('prompt: click activates the pressed action', () => {
  const el = new FakeEl();
  const p = new ResumePrompt(el);
  const calls = [];
  p.show({ title: 'T', position: 5, onStartOver: () => calls.push('start') });
  const btn = { dataset: { action: 'start-over' }, closest() { return this; } };
  p._onClick({ target: btn });
  assert.deepEqual(calls, ['start']);
  assert.equal(p.isOpen(), false);
});
