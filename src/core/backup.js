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
    const value = read(key, null);
    if (value != null) data[key] = value;
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
