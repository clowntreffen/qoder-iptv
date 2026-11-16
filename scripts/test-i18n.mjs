import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k)
};

function withLocale(locale, webOSLocale) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { language: locale, languages: [locale] },
    configurable: true,
    writable: true
  });
  globalThis.window = webOSLocale ? { webOSSystem: { locale: webOSLocale } } : {};
}

const { resolveLang, setLang, getLang, getLangPref, t, groupLabel } = await import('../src/core/i18n.js');
const { getSettings, saveSettings } = await import('../src/core/storage.js');

test('UI language fixed to English, never follows system or webOS locale', () => {
  for (const loc of ['zh-CN', 'zh_CN', 'zh-TW', 'zh-Hans-CN', 'zh', 'en-US', 'de-DE', '']) {
    withLocale(loc);
    assert.equal(resolveLang(), 'en', loc);
    assert.equal(getLang(), 'en', loc);
    assert.equal(getLangPref(), 'en', loc);
  }
  withLocale('en-US', 'zh-CN');
  assert.equal(resolveLang(), 'en');
  withLocale('zh-CN', 'en-US');
  assert.equal(resolveLang(), 'en');
});

test('setLang disabled: always returns false and never changes UI language', () => {
  assert.equal(setLang('zh'), false);
  assert.equal(setLang('en'), false);
  assert.equal(setLang(undefined), false);
  assert.equal(getLang(), 'en');
  assert.equal(t('settings.deviceInfo'), 'Device Info');
});

test('t returns English copy; missing key falls back to key', () => {
  assert.equal(t('settings.title'), 'Settings');
  assert.equal(t('toast.faved', { name: 'X' }), 'Favorited: X');
  assert.equal(t('no.such.key'), 'no.such.key');
});

test('groupLabel renders old and new ungrouped keys in English', () => {
  assert.equal(groupLabel('Ungrouped'), 'Ungrouped');
  assert.equal(groupLabel('\u672a\u5206\u7ec4'), 'Ungrouped');
  assert.equal(groupLabel('News'), 'News');
});

test('defaults to English; legacy Chinese/auto choices migrate to en; loads force en', () => {
  store.clear();
  const def = getSettings();
  assert.equal(def.language, 'en');
  assert.equal(def.languageVersion, 3);

  store.set('iptv:settings', JSON.stringify({ aspect: '4:3', language: 'zh', languageVersion: 2 }));
  const migrated = getSettings();
  assert.equal(migrated.language, 'en');
  assert.equal(migrated.aspect, '4:3');

  store.set('iptv:settings', JSON.stringify({ language: 'auto' }));
  assert.equal(getSettings().language, 'en');

  store.clear();
  saveSettings({ language: 'zh' });
  assert.equal(getSettings().language, 'en');
});

test('English dictionary has no empty keys or Chinese values', async () => {
  const src = await import('node:fs/promises').then((fs) =>
    fs.readFile(new URL('../src/core/i18n.js', import.meta.url), 'utf8')
  );
  const body = src.slice(src.indexOf('const DICT'), src.indexOf('const UNGROUPED'));
  assert.ok(body.includes('en: {'));
  assert.doesNotMatch(body, /zh:/);
  const keys = [...body.matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]);
  assert.ok(keys.length > 200);
  assert.equal(new Set(keys).size, keys.length);
  
  const values = [...body.matchAll(/^\s*'[^']+':\s*'(.*)',?\s*$/gm)].map((m) => m[1]);
  assert.ok(values.length > 100);
  assert.equal(values.filter((v) => /[\u4e00-\u9fff]/.test(v)).length, 0);
});