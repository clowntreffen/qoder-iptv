

export function resolveMediaUrl(uri, baseUrl) {
  const resolved = new URL(uri, baseUrl);
  if (import.meta.env?.DEV && uri.startsWith('/__proxy__?')) {
    return resolved.searchParams.get('u') || resolved.href;
  }
  return resolved.href;
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
