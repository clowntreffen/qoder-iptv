import { read, write } from './storage.js';

const KEY = 'reminders';
const MAX_REMINDERS = 200;
const DEFAULT_GRACE_MS = 15 * 60 * 1000;

function valid(item) {
  return item &&
    typeof item.channelKey === 'string' &&
    item.channelKey &&
    Number.isFinite(item.start);
}

export function getReminders() {
  const list = read(KEY, []);
  return Array.isArray(list) ? list.filter(valid) : [];
}

export function isReminder(channelKey, start) {
  return getReminders().some((r) => r.channelKey === channelKey && r.start === start);
}

export function addReminder(channelKey, start, title = '') {
  if (!channelKey || !Number.isFinite(start)) return false;
  const list = getReminders();
  if (list.some((r) => r.channelKey === channelKey && r.start === start)) return false;
  list.push({ channelKey, start, title: String(title || '') });
  list.sort((a, b) => a.start - b.start);
  write(KEY, list.slice(0, MAX_REMINDERS));
  return true;
}

export function removeReminder(channelKey, start) {
  const list = getReminders();
  const next = list.filter((r) => !(r.channelKey === channelKey && r.start === start));
  if (next.length !== list.length) write(KEY, next);
  return next.length !== list.length;
}

export function toggleReminder(channelKey, start, title = '') {
  if (isReminder(channelKey, start)) {
    removeReminder(channelKey, start);
    return false;
  }
  addReminder(channelKey, start, title);
  return true;
}

export function clearReminders() {
  write(KEY, []);
}

export function takeDueReminders(now = Date.now(), graceMs = DEFAULT_GRACE_MS) {
  const list = getReminders();
  const due = [];
  const keep = [];
  for (const r of list) {
    if (r.start > now) {
      keep.push(r);
      continue;
    }
    if (now - r.start <= graceMs) due.push(r);
  }
  if (due.length || keep.length !== list.length) write(KEY, keep);
  return due;
}
