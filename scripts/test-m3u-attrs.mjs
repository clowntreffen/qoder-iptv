// Run: node --test scripts/test-m3u-attrs.mjs


import test from 'node:test';
import assert from 'node:assert/strict';
import { parseM3U, renumberChannels, applyActiveSource } from '../src/core/m3uParser.js';
import { buildCatchupUrl } from '../src/core/catchup.js';
import { epgStore as store } from '../src/core/epgStore.js';

test('header-level catchup defaults apply to channels without their own attributes', () => {
  const { channels } = parseM3U([
    '#EXTM3U catchup="default" catchup-source="http://gw/{utc}-{utcend}" catchup-days="3"',
    '#EXTINF:-1 tvg-id="a" group-title="G",A',
    'http://a.m3u8',
    '#EXTINF:-1 tvg-id="b" group-title="G" catchup="append" catchup-days="14",B',
    'http://b.m3u8'
  ].join('\n'));
  assert.equal(channels[0].catchup, 'default');
  assert.equal(channels[0].catchupSource, 'http://gw/{utc}-{utcend}');
  assert.equal(channels[0].catchupDays, 3);
  assert.equal(channels[1].catchup, 'append'); 
  assert.equal(channels[1].catchupDays, 14); 
});

test('catchup-type and tvg-rec aliases resolve like tivimate-style sources', () => {
  const { channels } = parseM3U([
    '#EXTM3U',
    '#EXTINF:-1 tvg-id="a" group-title="G" catchup-type="flussonic",A',
    'http://a.m3u8',
    '#EXTINF:-1 tvg-id="b" group-title="G" tvg-rec="14",B',
    'http://b.m3u8'
  ].join('\n'));
  assert.equal(channels[0].catchup, 'flussonic');
  assert.equal(channels[1].catchup, 'default'); 
  assert.equal(channels[1].catchupDays, 14);
});

test('legacy timeshift alias keeps day semantics and is not overridden by header days', () => {
  const { channels } = parseM3U([
    '#EXTM3U catchup-days="2"',
    '#EXTINF:-1 group-title="G",A',
    'http://a.m3u8',
    '#EXTINF:-1 group-title="G" timeshift="5",B',
    'http://b.m3u8'
  ].join('\n'));
  assert.equal(channels[0].catchupDays, 2);
  assert.equal(channels[0].catchup, 'default');
  assert.equal(channels[1].catchupDays, 5); 
});

test('commas inside quoted attributes do not cut the channel name or group title', () => {
  const { channels } = parseM3U([
    '#EXTM3U',
    '#EXTINF:-1 tvg-id="a" group-title="News, Sport",News & <Sport>',
    'http://a.m3u8'
  ].join('\n'));
  assert.equal(channels[0].group, 'News, Sport');
  assert.equal(channels[0].name, 'News & <Sport>');
});

test('header catchup-source backfills while channel catchup-days wins', () => {
  const { channels } = parseM3U([
    '#EXTM3U catchup-source="?utc={utc}&lutc={lutc}" catchup-days="7"',
    '#EXTINF:-1 group-title="G" catchup-days="1",A',
    'http://a.m3u8'
  ].join('\n'));
  assert.equal(channels[0].catchupSource, '?utc={utc}&lutc={lutc}');
  assert.equal(channels[0].catchupDays, 1);
});

test('tvg-shift resolves per channel with header fallback and defaults to 0', () => {
  const { channels } = parseM3U([
    '#EXTM3U tvg-shift="2"',
    '#EXTINF:-1 group-title="G",A',
    'http://a.m3u8',
    '#EXTINF:-1 group-title="G" tvg-shift="-5",B',
    'http://b.m3u8',
    '#EXTINF:-1 group-title="G" tvg-shift="junk",C',
    'http://c.m3u8'
  ].join('\n'), 'http://x/list.m3u');
  assert.equal(channels[0].tvgShift, 2); 
  assert.equal(channels[1].tvgShift, -5); 
  assert.equal(channels[2].tvgShift, 2); 
  const bare = parseM3U('#EXTINF:-1 group-title="G",D\nhttp://d.m3u8').channels;
  assert.equal(bare[0].tvgShift, 0);
});

test('tvg-shift merges from the first source that declares it', () => {
  const { channels } = parseM3U([
    '#EXTM3U',
    '#EXTINF:-1 group-title="G",Same',
    'http://a.m3u8',
    '#EXTINF:-1 group-title="G" tvg-shift="3",Same',
    'http://b.m3u8'
  ].join('\n'));
  assert.equal(channels.length, 1);
  assert.equal(channels[0].tvgShift, 3);
});

function chan(chnoRaw) {
  return { chnoRaw, group: 'G' };
}

test('renumber without any tvg-chno keeps sequential per-group numbering', () => {
  const list = [chan(0), chan(0), chan(0)];
  renumberChannels(list);
  assert.deepEqual(list.map((c) => c.chno), ['1', '2', '3']);
  assert.deepEqual(list.map((c) => c.index), [1, 2, 3]);
});

test('declared tvg-chno is preserved; duplicates and gaps are auto-filled', () => {
  const list = [chan(0), chan(5), chan(5), chan(0), chan(12)];
  renumberChannels(list);
  
  assert.deepEqual(list.map((c) => c.chno), ['1', '5', '2', '3', '12']);
  
  assert.deepEqual(list.map((c) => c.index), [1, 2, 3, 4, 5]);
});

test('non-numeric tvg-chno is ignored and its channel gets a free number', () => {
  const list = [chan(9), chan(-3), chan(0)];
  renumberChannels(list);
  assert.deepEqual(list.map((c) => c.chno), ['9', '1', '2']);
});

test('tvg-chno stays stable when main.js renumbers a filtered subset', () => {
  const list = [chan(0), chan(101), chan(0), chan(103)];
  renumberChannels(list.filter((c) => c.chnoRaw !== 103)); 
  assert.deepEqual(list.filter((c) => c.chno).map((c) => c.chno), ['1', '101', '2']);
});

test('shifted EPG view offsets times, exposes originals via _epg and caches by identity', () => {
  const base = new Date(2026, 8, 10, 8).getTime();
  const raw = [
    { start: base, stop: base + 3600000, title: 'A', desc: '' },
    { start: base + 3600000, stop: NaN, title: 'B', desc: '' }
  ];
  store.clear();
  store.mode = 'xmltv';
  store.loaded = true;
  store.programmes.set('tv', raw);
  const channel = { key: 'tv', name: 'TV', epgName: 'TV', tvgId: 'tv', tvgShift: 2 };
  const two = store.getList(channel);
  assert.equal(two[0].start, base + 2 * 3600000);
  assert.equal(two[0].stop, base + 3 * 3600000);
  assert.equal(two[1].stop + 2 * 3600000, NaN); 
  assert.equal(two[0]._epg, raw[0]); 
  assert.equal(store.getList(channel), two); 
  assert.equal(store.getList({ ...channel, tvgShift: 0 })[0], raw[0]); 
  assert.equal(raw[0].start, base); 
  const one = store.getList({ ...channel, tvgShift: 1 });
  assert.equal(one[0].start, base + 3600000);
  assert.equal(store.getList({ ...channel, tvgShift: 2 }), two); 
  store.clear();
  store.mode = 'xmltv';
  store.loaded = true;
  assert.deepEqual(store.getList(channel), []); 
});

test('seek_preview is parsed per channel, from the header, and per source', () => {
  const { channels } = parseM3U([
    '#EXTM3U seek_preview="http://cdn/preview/{utc}.jpg"',
    '#EXTINF:-1 group-title="G",A',
    'http://a.m3u8',
    '#EXTINF:-1 group-title="G" seek-preview="http://cdn/dash/{utc}.jpg",B',
    'http://b.m3u8'
  ].join('\n'));
  assert.equal(channels[0].seekPreview, 'http://cdn/preview/{utc}.jpg');
  assert.equal(channels[1].seekPreview, 'http://cdn/dash/{utc}.jpg');
  // Without any attribute the channel has no template.
  const bare = parseM3U('#EXTINF:-1 group-title="G",C\nhttp://c.m3u8').channels;
  assert.equal(bare[0].seekPreview, '');
  // Same channel on two URLs: each source keeps its own template and the
  // active one wins after a switch.
  const dup = parseM3U([
    '#EXTM3U',
    '#EXTINF:-1 group-title="G" tvg-id="d" seek_preview="http://cdn/x/{utc}.jpg",Same',
    'http://a.m3u8',
    '#EXTINF:-1 group-title="G" tvg-id="d",Same',
    'http://b.m3u8'
  ].join('\n')).channels;
  assert.equal(dup.length, 1);
  assert.equal(dup[0].seekPreview, 'http://cdn/x/{utc}.jpg');
  dup[0].sourceIdx = 1;
  applyActiveSource(dup[0]);
  assert.equal(dup[0].seekPreview, '');
});

test('catchup URLs use the source timeline (_epg), not the shifted display time', () => {
  const base = new Date(Date.UTC(2026, 8, 10, 0)).getTime();
  const shifted = {
    start: base + 5 * 3600000,
    stop: base + 6 * 3600000,
    title: 'A',
    _epg: { start: base, stop: base + 3600000 }
  };
  const url = buildCatchupUrl(
    { url: 'http://gw/live.m3u8', catchup: 'append' },
    shifted
  );
  assert.equal(url, 'http://gw/live.m3u8?utc=' + base / 1000 + '&lutc=' + Math.floor(Date.now() / 1000));
  
  const plain = buildCatchupUrl(
    { url: 'http://gw/live.m3u8', catchup: 'append' },
    { start: base, stop: base + 3600000 }
  );
  assert.equal(plain, 'http://gw/live.m3u8?utc=' + base / 1000 + '&lutc=' + Math.floor(Date.now() / 1000));
});
