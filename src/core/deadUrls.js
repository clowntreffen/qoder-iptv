export const DEAD_URL_TTL_MS = 30 * 60 * 1000;

function timestamps(source) {
  const at = source && source.deadUrlsAt;
  return at && typeof at === 'object' && !Array.isArray(at) ? at : {};
}

export function activeDeadUrls(source, now = Date.now()) {
  if (!source || !Array.isArray(source.deadUrls)) return [];
  const at = timestamps(source);
  return source.deadUrls.filter((url) => {
    const ts = at[url];
    return Number.isFinite(ts) && ts <= now && now - ts < DEAD_URL_TTL_MS;
  });
}

export function stampDeadUrls(urls, now = Date.now()) {
  const at = {};
  for (const url of urls || []) {
    if (url) at[url] = now;
  }
  return at;
}

export function mergeDeadUrls(urls, previous, now = Date.now()) {
  const prev = timestamps({ deadUrlsAt: previous });
  const list = [...new Set((urls || []).filter(Boolean))];
  const at = {};
  for (const url of list) {
    const ts = prev[url];
    at[url] = Number.isFinite(ts) && ts <= now ? ts : now;
  }
  return at;
}
