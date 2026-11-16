import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchM3U } from '../src/core/m3uParser.js';
import { epgStore } from '../src/core/epgStore.js';
import { clearM3uCache } from '../src/core/storage.js';

function useStorage() {
  const data = new Map();
  globalThis.localStorage = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    clear: () => data.clear(),
    key: (i) => [...data.keys()][i] ?? null,
    get length() { return data.size; }
  };
  return data;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('M3U fetch falls back to the last cached playlist when offline', async () => {
  useStorage();
  clearM3uCache();
  const url = 'https://cache.test/list.m3u?unique=m3u';
  const playlist = '#EXTM3U\n#EXTINF:-1 group-title="News",Cached TV\nhttps://cache.test/tv.m3u8';
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, status: 200, url, text: async () => playlist });
    const online = await fetchM3U(url);
    assert.equal(online.channels[0].name, 'Cached TV');

    globalThis.fetch = async () => { throw new Error('offline'); };
    const offline = await fetchM3U(url);
    assert.equal(offline.channels[0].name, 'Cached TV');
    assert.equal(offline.channels[0].url, 'https://cache.test/tv.m3u8');
  } finally {
    globalThis.fetch = original;
    clearM3uCache();
  }
});

test('XMLTV load falls back to stale cached data when the network fails', async () => {
  const data = useStorage();
  const url = 'https://cache.test/epg.xml?unique=epg';
  const channel = { key: 'tv', name: 'TV', epgName: 'TV', tvgId: 'tv', index: 1 };
  const now = Date.now();
  data.set('iptv:epg:' + url, JSON.stringify({
    expire: now - 1,
    data: {
      channels: [{ id: 'tv', name: 'TV' }],
      programmes: [['tv', [{ start: now - 3600000, stop: now + 3600000, title: 'Cached Programme', desc: '' }]]]
    }
  }));
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new Error('offline'); };
    assert.equal(await epgStore.load(url, 'xmltv'), true);
    await flush();
    assert.equal(epgStore.loaded, true);
    assert.equal(epgStore.getList(channel)[0].title, 'Cached Programme');
  } finally {
    globalThis.fetch = original;
    epgStore.clear();
  }
});
