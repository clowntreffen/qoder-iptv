// Seek preview thumbnails for catch-up. Three sources, in priority order:
// an explicit `seek_preview` template from the playlist, Flussonic's
// `{utc}-preview.jpg`, and Nimble Streamer's `dvr_thumbnail_{utc}.jpg`.
// Everything stays pure so it can be unit-tested without a player.

import { replaceTokens } from './catchup.js';

const FLUSSONIC_FILE = /^(?:(?:index|mono|video|archive|audio|tracks-[\w,]+)-\d+-(?:\d+|now)\.(?:m3u8|mpd|ts)|(?:video-)?timeshift_(?:abs|rel)-\d+\.(?:m3u8|ts|mpd)|archive-\d+-\d+\.mp4)$/i;
const FLUSSONIC_GENERIC_FILE = /^(?:index|mono|video)\.m3u8$|^(?:index|Manifest)\.mpd$|^mpegts$/i;
const FLUSSONIC_CATCHUP = /^(?:flussonic|fs|flussonic-(?:hls|dash|ts))$/i;
const NIMBLE_FILE = /^playlist(?:_fmp4)?_dvr(?:_range-\d+-\d+|_timeshift-\d+(?:-\d+)?)?\.m3u8$/i;

// UTC buckets keep the thumbnail stable while the user holds Left/Right.
export const PREVIEW_STEP = 10;

function splitUrl(raw) {
  const url = String(raw || '');
  const m = /^(https?:\/\/[^/]+)(\/[^?#]*)?(\?[^#]*)?/i.exec(url);
  if (!m) return null;
  const path = m[2] || '/';
  const slash = path.lastIndexOf('/');
  return {
    origin: m[1],
    dir: m[1] + path.slice(0, slash + 1),
    file: path.slice(slash + 1),
    query: m[3] || ''
  };
}

export function flussonicPreviewTemplate(streamUrl, catchupType) {
  const parts = splitUrl(streamUrl);
  if (!parts || !/^https?:\/\/[^/]+\/.+\//i.test(parts.dir)) return '';
  const known = FLUSSONIC_FILE.test(parts.file) ||
    (FLUSSONIC_CATCHUP.test(String(catchupType || '')) && FLUSSONIC_GENERIC_FILE.test(parts.file));
  return known ? `${parts.dir}{utc}-preview.jpg${parts.query}` : '';
}

export function nimblePreviewTemplate(streamUrl) {
  const parts = splitUrl(streamUrl);
  if (!parts || !NIMBLE_FILE.test(parts.file)) return '';
  return `${parts.dir}dvr_thumbnail_{utc}.jpg${parts.query}`;
}

// The template a channel can actually use, or '' when it has none.
export function previewTemplateFor(channel) {
  if (!channel) return '';
  if (channel.seekPreview) return channel.seekPreview;
  return flussonicPreviewTemplate(channel.url, channel.catchup) ||
    nimblePreviewTemplate(channel.url);
}

export function previewUrlFor(template, utcSec, nowSec = Math.floor(Date.now() / 1000)) {
  if (!template || !Number.isFinite(utcSec)) return null;
  const start = Math.floor(utcSec / PREVIEW_STEP) * PREVIEW_STEP;
  const url = replaceTokens(template, {
    start,
    end: start,
    now: nowSec,
    duration: PREVIEW_STEP,
    offset: 0,
    catchupId: ''
  });
  return /^https?:\/\//i.test(url) ? url : null;
}
