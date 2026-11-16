import { read, write } from './storage.js';

const APP = 'qoder-iptv';
const VERSION = 1;
const KEYS = ['sources', 'activeSource', 'favorites', 'settings', 'lastChannel', 'lastSource', 'recents', 'reminders'];
const ARRAYS = new Set(['sources', 'favorites', 'recents', 'reminders']);
const OBJECTS = new Set(['settings', 'lastSource']);

function validValue(key, value) {
  if (value == null) return true;
  if (ARRAYS.has(key)) return Array.isArray(value);
  if (OBJECTS.has(key)) return typeof value === 'object' && !Array.isArray(value);
  return typeof value === 'string';
}

export function createBackup() {
  const data = {};
  for (const key of KEYS) {
    let value = read(key, null);
    if (value == null) continue;
    // 备份是用户可复制/外发的文本：不带家长 PIN（哪怕已是哈希），
    // 恢复后沿用本机现存的 PIN 设置，不把锁屏凭据搬来搬去。
    if (key === 'settings' && typeof value === 'object' && value !== null) {
      const settings = { ...value };
      delete settings.parentalPin;
      value = settings;
    }
    data[key] = value;
  }
  return { app: APP, version: VERSION, exportedAt: new Date().toISOString(), data };
}

export function backupText() {
  return JSON.stringify(createBackup());
}

export function restoreBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error('Invalid backup JSON');
  }
  if (!parsed || parsed.app !== APP || !parsed.data || typeof parsed.data !== 'object') {
    throw new Error('Not a Qoder IPTV backup');
  }
  for (const key of KEYS) {
    if (key in parsed.data && !validValue(key, parsed.data[key])) {
      throw new Error('Invalid backup data');
    }
  }
  let restored = 0;
  for (const key of KEYS) {
    if (!(key in parsed.data)) continue;
    write(key, parsed.data[key]);
    restored++;
  }
  return restored;
}
