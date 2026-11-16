// Run: node --test scripts/test-seek-preview.mjs
// Provider detection, template expansion and the CatchupBar thumbnail.

import test from 'node:test';
import assert from 'node:assert/strict';

const {
  flussonicPreviewTemplate,
  nimblePreviewTemplate,
  previewTemplateFor,
  previewUrlFor,
  PREVIEW_STEP
} = await import('../src/core/seekPreview.js');
const { CatchupBar } = await import('../src/ui/CatchupBar.js');

class FakeClassList {
  constructor() { this.set = new Set(); }
  add(c) { this.set.add(c); }
  remove(c) { this.set.delete(c); }
  contains(c) { return this.set.has(c); }
  toggle(c, force) {
    const want = force === undefined ? !this.set.has(c) : !!force;
    if (want) this.set.add(c); else this.set.delete(c);
  }
}

test('Flussonic preview template needs a known file name or the matching catch-up type', () => {
  assert.equal(
    flussonicPreviewTemplate('http://host/a/index-1700000000-3600.m3u8', ''),
    'http://host/a/{utc}-preview.jpg'
  );
  assert.equal(
    flussonicPreviewTemplate('http://host/a/video-1700000000-now.m3u8?token=x', ''),
    'http://host/a/{utc}-preview.jpg?token=x'
  );
  assert.equal(
    flussonicPreviewTemplate('http://host/a/index.m3u8', 'flussonic'),
    'http://host/a/{utc}-preview.jpg'
  );
  assert.equal(flussonicPreviewTemplate('http://host/a/index.m3u8', 'append'), '');
  assert.equal(flussonicPreviewTemplate('http://host/a/live.m3u8', 'flussonic'), '');
  assert.equal(flussonicPreviewTemplate('http://host/index-1-2.m3u8', ''), '');
  assert.equal(flussonicPreviewTemplate('not a url', ''), '');
  assert.equal(flussonicPreviewTemplate('', ''), '');
});

test('Nimble preview template is read from the DVR playlist name', () => {
  assert.equal(
    nimblePreviewTemplate('http://host/a/playlist_dvr.m3u8'),
    'http://host/a/dvr_thumbnail_{utc}.jpg'
  );
  assert.equal(
    nimblePreviewTemplate('http://host/a/playlist_fmp4_dvr_timeshift-120-30.m3u8?k=1'),
    'http://host/a/dvr_thumbnail_{utc}.jpg?k=1'
  );
  assert.equal(nimblePreviewTemplate('http://host/a/playlist.m3u8'), '');
  assert.equal(nimblePreviewTemplate('http://host/a/other_dvr.m3u8'), '');
});

test('previewTemplateFor prefers an explicit seek_preview attribute', () => {
  const seekPreview = 'http://cdn/preview/{utc:YmdHMS}.jpg';
  assert.equal(
    previewTemplateFor({
      url: 'http://host/a/index-1-2.m3u8',
      catchup: 'flussonic',
      seekPreview
    }),
    seekPreview
  );
  assert.equal(
    previewTemplateFor({ url: 'http://host/a/index-1-2.m3u8', catchup: 'flussonic' }),
    'http://host/a/{utc}-preview.jpg'
  );
  assert.equal(
    previewTemplateFor({ url: 'http://host/a/playlist_dvr.m3u8' }),
    'http://host/a/dvr_thumbnail_{utc}.jpg'
  );
  assert.equal(previewTemplateFor({ url: 'http://host/a/live.m3u8' }), '');
  assert.equal(previewTemplateFor(null), '');
});

test('previewUrlFor fills {utc} and rounds to the preview bucket', () => {
  const utc = 1700000005;
  const url = previewUrlFor('http://host/a/{utc}-preview.jpg', utc, 1700000100);
  const bucket = Math.floor(utc / PREVIEW_STEP) * PREVIEW_STEP;
  assert.equal(url, `http://host/a/${bucket}-preview.jpg`);
  assert.equal(previewUrlFor('http://host/a/{utc}-preview.jpg', utc), url);
  assert.equal(previewUrlFor('', utc), null);
  assert.equal(previewUrlFor('http://host/a/{utc}-preview.jpg', NaN), null);
  // A template with a placeholder this app cannot fill yields no preview.
  assert.equal(previewUrlFor('/rel/{utc}.jpg', utc), null);
});

function fakeBar(channel) {
  const box = { classList: new FakeClassList(), querySelector: () => img };
  const img = { src: '', onerror: null };
  const stub = { style: {}, classList: new FakeClassList() };
  const el = {
    innerHTML: '',
    classList: new FakeClassList(),
    addEventListener() {},
    querySelector: (sel) => {
      if (sel === '.cb-preview') return box;
      if (sel === '.cb-preview img') return img;
      if (sel === '.cb-fill' || sel === '.cb-knob' || sel === '.cb-cur' || sel === '.cb-dur') return stub;
      return null;
    },
    querySelectorAll: () => []
  };
  const player = {
    current: { channel },
    position: () => 0,
    rate: 1,
    isCatchup: () => true,
    video: { duration: 600 },
    speedBlocked: () => '',
    rateSettling: () => false,
    rateStats: () => null,
    seekTo() {}
  };
  return { bar: new CatchupBar(el, player), box, img, el, player };
}

test('CatchupBar shows the preview while seeking and hides it again', () => {
  const base = Date.UTC(2026, 0, 1, 12, 0, 0);
  const channel = { key: 'k', url: 'http://host/a/index-1-2.m3u8', catchup: 'flussonic' };
  const { bar, box, img, player } = fakeBar(channel);
  const programme = { start: base, stop: base + 3600000, title: 'Show', _epg: { start: base, stop: base + 3600000 } };

  bar.show(programme);
  assert.equal(box.classList.contains('hidden'), true);

  bar._preview = 125;
  bar._tick();
  assert.equal(box.classList.contains('hidden'), false);
  assert.equal(
    img.src,
    previewUrlFor('http://host/a/{utc}-preview.jpg', Math.floor(base / 1000) + 125)
  );

  const first = img.src;
  bar._preview = 400;
  bar._tick();
  assert.notEqual(img.src, first);

  // A dead URL disables previews for this provider instead of flashing.
  img.onerror();
  assert.equal(box.classList.contains('hidden'), true);
  bar._tick();
  assert.equal(box.classList.contains('hidden'), true);

  // Leaving seek mode hides the box as well.
  player.current.channel = { key: 'other', url: 'http://host/a/live.m3u8' };
  bar._previewFailed = '';
  bar._tplKey = null;
  bar._preview = 30;
  bar._tick();
  assert.equal(box.classList.contains('hidden'), true);

  bar.close();
});

test('CatchupBar leaves the box hidden when the programme has no start time', () => {
  const channel = { key: 'k', url: 'http://host/a/index-1-2.m3u8', catchup: 'flussonic' };
  const { bar, box } = fakeBar(channel);
  bar.show({ title: 'No timing' });
  bar._preview = 10;
  bar._tick();
  assert.equal(box.classList.contains('hidden'), true);
  bar.close();
});
