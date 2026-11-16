// Run: node --test scripts/test-themes.mjs
// Theme registry, stored-settings validation and the Settings rows.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mem = Object.create(null);
globalThis.localStorage = {
  get length() { return Object.keys(mem).length; },
  key: (i) => Object.keys(mem)[i],
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; }
};

const { THEMES, DEFAULT_THEME, isValidTheme, themeName } = await import('../src/core/themes.js');
const { getSettings, saveSettings } = await import('../src/core/storage.js');
const { Settings } = await import('../src/ui/Settings.js');

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
function fakeEl() {
  return {
    innerHTML: '',
    classList: new FakeClassList(),
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => []
  };
}

const cssPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles', 'main.css');

test('theme registry: unique ids, known default, day/night coverage', () => {
  const ids = THEMES.map((theme) => theme.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(isValidTheme(DEFAULT_THEME));
  assert.ok(THEMES.some((theme) => theme.id === 'daylight'));
  assert.equal(themeName('ember'), 'Ember');
  assert.equal(themeName('nope'), themeName(DEFAULT_THEME));
  assert.equal(isValidTheme(''), false);
  assert.equal(isValidTheme(null), false);
});

test('every registered theme has a CSS palette block', () => {
  const css = fs.readFileSync(cssPath, 'utf8');
  // Midnight is the :root default and needs no data-theme block.
  assert.match(css, /:root\s*{[^}]*--ui-surface/);
  for (const theme of THEMES) {
    if (theme.id === DEFAULT_THEME) continue;
    assert.match(css, new RegExp(`html\\[data-theme="${theme.id}"\\]`), theme.id);
  }
});

test('settings: defaults to midnight, migrates invalid themes, clamps the scale', () => {
  localStorage.removeItem('iptv:settings');
  assert.equal(getSettings().theme, DEFAULT_THEME);
  saveSettings({ theme: 'not-a-theme', fontScale: 4 });
  const s = getSettings();
  assert.equal(s.theme, DEFAULT_THEME);
  assert.equal(s.fontScale, 1);
  saveSettings({ theme: 'emerald', fontScale: 1.2 });
  assert.equal(getSettings().theme, 'emerald');
  assert.equal(getSettings().fontScale, 1.2);
});

test('settings panel cycles themes and every text scale step', () => {
  localStorage.removeItem('iptv:settings');
  const el = fakeEl();
  const panel = new Settings(el);
  panel.open();
  let changes = 0;
  panel.onChange = () => { changes++; };

  const themeRow = panel._rows().findIndex((row) => row.key === 'theme');
  panel.focusIdx = themeRow;
  panel._cycle(1);
  assert.notEqual(panel.s.theme, DEFAULT_THEME);
  panel._cycle(-1);
  assert.equal(panel.s.theme, DEFAULT_THEME);

  const scaleRow = panel._rows().findIndex((row) => row.key === 'fontScale');
  panel.focusIdx = scaleRow;
  const seen = new Set([panel.s.fontScale]);
  for (let i = 0; i < 5; i++) {
    panel._cycle(1);
    seen.add(panel.s.fontScale);
  }
  assert.deepEqual([...seen].sort((a, b) => a - b), [0.8, 0.9, 1, 1.1, 1.2, 1.3]);
  assert.equal(getSettings().fontScale, panel.s.fontScale);
  assert.ok(changes >= 7);

  // Rendered rows carry the theme name and the percent scale.
  const html = el.innerHTML;
  assert.match(html, new RegExp(themeName(panel.s.theme)));
  assert.match(html, new RegExp(`${Math.round(panel.s.fontScale * 100)}%`));
});
