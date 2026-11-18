

export function resolveMediaUrl(uri, baseUrl) {
  const resolved = new URL(uri, baseUrl);
  if (import.meta.env?.DEV && uri.startsWith('/__proxy__?')) {
    return resolved.searchParams.get('u') || resolved.href;
  }
  return resolved.href;
}

// Provider-agnostic remux manifest pattern: <host>/ts/<id>/index.m3u8
const REMUX_MANIFEST_RE = /\/ts\/[^/?#]+\/index\.m3u8(?:[?#]|$)/i;

export function isRemuxUrl(raw) {
  return typeof raw === 'string' && REMUX_MANIFEST_RE.test(raw);
}

export function proxied(url) {
  if (!url) return url;
  try {
    if (import.meta && import.meta.env && import.meta.env.DEV) {
      if (/^https?:\/\//i.test(url)) {
        return '/__proxy__?u=' + encodeURIComponent(url);
      }
    }
  } catch (e) {}
  return url;
}
