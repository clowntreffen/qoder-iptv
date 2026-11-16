import test from 'node:test';
import assert from 'node:assert/strict';
import {
  read, recordRecent, getRecents, clearRecents,
  setM3uCache, getM3uCache, clearM3uCache,
  saveSources, getSources, setActiveSourceId, getActiveSourceId,
  saveFavorites, toggleFavorite, saveSettings, getSettings
} from '../src/core/storage.js';
import { addReminder, getReminders, takeDueReminders } from '../src/core/reminders.js';
import { backupText, createBackup, restoreBackup } from '../src/core/backup.js';

function useStorage() {
  const data = Object.create(null);
  Object.defineProperties(data, {
    getItem: { value: (k) => (k in data ? data[k] : null) },
    setItem: { value: (k, v) => { data[k] = String(v); } },
    removeItem: { value: (k) => { delete data[k]; } },
    clear: { value: () => { for (const k of Object.keys(data)) delete data[k]; } },
    key: { value: (i) => Object.keys(data)[i] ?? null },
    length: { get: () => Object.keys(data).length }
  });
  globalThis.localStorage = data;
  return data;
}

test('recent channels are deduplicated, newest first, and capped', () => {
  useStorage();
  clearRecents();
  for (let i = 0; i < 35; i++) recordRecent('ch' + i);
  recordRecent('ch34');
  const list = getRecents();
  assert.equal(list.length, 30);
  assert.equal(list[0], 'ch34');
  assert.equal(list[1], 'ch33');
  assert.equal(list.includes('ch4'), false);
  clearRecents();
  assert.deepEqual(getRecents(), []);
});

test('M3U offline cache stores text and clears only playlist entries', () => {
  const data = useStorage();
  data['other'] = '1';
  data['iptv:epg:x'] = '2';
  assert.equal(setM3uCache('https://x.test/a.m3u', '#EXTM3U\n', 'https://x.test/'), true);
  const cache = getM3uCache('https://x.test/a.m3u');
  assert.equal(cache.text, '#EXTM3U\n');
  assert.equal(cache.baseUrl, 'https://x.test/');
  assert.equal(typeof cache.fetchedAt, 'number');
  clearM3uCache();
  assert.equal(getM3uCache('https://x.test/a.m3u'), null);
  assert.equal(data.other, '1');
  assert.equal(data['iptv:epg:x'], '2');
});

test('backup round-trips sources, settings, favorites, recents and reminders', () => {
  const data = useStorage();
  saveSources([{ id: 's1', name: 'One', m3uUrl: 'https://x.test/a.m3u', epgUrl: '' }]);
  setActiveSourceId('s1');
  saveSettings({ aspect: '4:3', showNetSpeed: true });
  saveFavorites(['ch1']);
  toggleFavorite('ch2');
  recordRecent('ch2');
  addReminder('ch2', 123456, 'News');

  const backup = createBackup();
  assert.equal(backup.app, 'qoder-iptv');
  assert.equal(backup.version, 1);
  assert.equal(backup.data.sources[0].name, 'One');
  const text = backupText();
  assert.match(text, /"app":"qoder-iptv"/);

  data.clear();
  assert.equal(restoreBackup(text), 6);
  assert.deepEqual(getSources(), [{ id: 's1', name: 'One', m3uUrl: 'https://x.test/a.m3u', epgUrl: '' }]);
  assert.equal(getActiveSourceId(), 's1');
  assert.equal(getSettings().aspect, '4:3');
  assert.equal(getSettings().showNetSpeed, true);
  assert.deepEqual(read('favorites'), ['ch1', 'ch2']);
  assert.deepEqual(getRecents(), ['ch2']);
  assert.deepEqual(getReminders(), [{ channelKey: 'ch2', start: 123456, title: 'News' }]);
});

test('backup rejects JSON from other apps, malformed data and wrong value types', () => {
  useStorage();
  assert.throws(() => restoreBackup('{'), /Invalid backup JSON/);
  assert.throws(() => restoreBackup('{"app":"other","data":{}}'), /Not a Qoder IPTV backup/);
  assert.throws(() => restoreBackup('{"app":"qoder-iptv"}'), /Not a Qoder IPTV backup/);
  assert.throws(
    () => restoreBackup('{"app":"qoder-iptv","data":{"sources":{}}}'),
    /Invalid backup data/
  );
  assert.throws(
    () => restoreBackup('{"app":"qoder-iptv","data":{"settings":[]}}'),
    /Invalid backup data/
  );
});

test('backup never contains the parental PIN (plain or hashed)', () => {
  const data = useStorage();
  saveSettings({ aspect: '4:3', parentalPin: '1234', appLock: true });
  const backup = createBackup();
  assert.equal(backup.data.settings.parentalPin, undefined);
  assert.equal(backup.data.settings.appLock, true);
  const text = backupText();
  assert.doesNotMatch(text, /1234/);
  assert.match(text, /"settings":\{[^}]*"aspect":"4:3"/);

  data.clear();
  assert.equal(restoreBackup(text), 1);
  assert.equal(getSettings().parentalPin, '', '恢复备份不写入/恢复 PIN');
  assert.equal(getSettings().appLock, true);
});

test('due reminders are returned once and expired ones are discarded', () => {
  useStorage();
  addReminder('ch1', 1000, 'Due');
  addReminder('ch2', 5000, 'Future');
  addReminder('ch3', 0, 'Old');
  assert.deepEqual(takeDueReminders(2000, 1500).map((r) => r.title), ['Due']);
  assert.deepEqual(getReminders().map((r) => r.title), ['Future']);
  assert.deepEqual(takeDueReminders(2000, 1500), []);
});
