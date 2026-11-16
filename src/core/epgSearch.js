// Programme search over the EPG store. The store hands over a flat entry
// list; this module only filters and ranks it, so it stays unit-testable
// without a DOM or network.

const DAY_MS = 24 * 3600 * 1000;
const DEFAULT_DAYS = 14;

export function programmeEntries(programmes) {
  const out = [];
  if (!programmes || typeof programmes.forEach !== 'function') return out;
  programmes.forEach((list, key) => {
    for (const p of list || []) {
      out.push({
        key,
        start: p.start,
        stop: p.stop,
        title: p.title || '',
        desc: p.desc || ''
      });
    }
  });
  return out;
}

// Matches every whitespace-separated term against title and description.
// Results stay inside a window from yesterday to `days` ahead, with what is
// still running or upcoming first and past programmes after it.
export function searchProgrammeEntries(entries, query, opts = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (!q || !Array.isArray(entries)) return [];
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const days = Number.isFinite(opts.days) ? opts.days : DEFAULT_DAYS;
  const limit = Number.isFinite(opts.limit) ? opts.limit : 200;
  const from = now - DAY_MS;
  const to = now + days * DAY_MS;
  const terms = q.split(/\s+/).filter(Boolean);
  const out = [];
  for (const entry of entries) {
    const start = entry.start;
    if (!Number.isFinite(start)) continue;
    const stop = Number.isFinite(entry.stop) ? entry.stop : start + 3600000;
    if (stop < from || start > to) continue;
    const hay = (entry.title + ' ' + (entry.desc || '')).toLowerCase();
    if (!terms.every((term) => hay.includes(term))) continue;
    out.push(entry);
  }
  out.sort((a, b) => {
    const aPast = (Number.isFinite(a.stop) ? a.stop : a.start + 3600000) < now ? 1 : 0;
    const bPast = (Number.isFinite(b.stop) ? b.stop : b.start + 3600000) < now ? 1 : 0;
    return (aPast - bPast) || (a.start - b.start);
  });
  return out.slice(0, limit);
}
