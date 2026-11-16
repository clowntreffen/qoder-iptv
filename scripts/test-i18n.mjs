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

test('UI 语言固定英文，绝不跟随系统或 webOS locale', () => {
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

test('setLang 已停用：永远返回 false 且不改变界面语言', () => {
  assert.equal(setLang('zh'), false);
  assert.equal(setLang('en'), false);
  assert.equal(setLang(undefined), false);
  assert.equal(getLang(), 'en');
  assert.equal(t('settings.deviceInfo'), 'Device Info');
});

test('t 返回英文文案；缺键回退 key 本身', () => {
  assert.equal(t('settings.title'), 'Settings');
  assert.equal(t('toast.faved', { name: 'X' }), 'Favorited: X');
  assert.equal(t('no.such.key'), 'no.such.key');
});

test('groupLabel 把新旧未分组键都显示成英文', () => {
  assert.equal(groupLabel('Ungrouped'), 'Ungrouped');
  assert.equal(groupLabel('未分组'), 'Ungrouped');
  assert.equal(groupLabel('News'), 'News');
});

test('设置默认英文；旧版中文/自动选择迁移到 en，且读档强制 en', () => {
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

test('英文词典无空键、无中文值', async () => {
  const src = await import('node:fs/promises').then((fs) =>
    fs.readFile(new URL('../src/core/i18n.js', import.meta.url), 'utf8')
  );
  const body = src.slice(src.indexOf('const DICT'), src.indexOf('const UNGROUPED'));
  assert.ok(body.includes('en: {'));
  assert.doesNotMatch(body, /zh:/);
  const keys = [...body.matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]);
  assert.ok(keys.length > 200);
  assert.equal(new Set(keys).size, keys.length);
  // 只看字符串值，不看注释：UI 文案不得出现中文。
  const values = [...body.matchAll(/^\s*'[^']+':\s*'(.*)',?\s*$/gm)].map((m) => m[1]);
  assert.ok(values.length > 100);
  assert.equal(values.filter((v) => /[\u4e00-\u9fff]/.test(v)).length, 0);
});