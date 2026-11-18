// Remembers the last chosen audio/subtitle track per channel.
// The player applies the saved choice when a channel starts; a change made in
// the live player is stored back through saveChannelTrack().
//
// Stored per channel key: { audioIndex, audioLabel, subtitleIndex, subtitleLabel }
// Index and label are kept together so a shifted manifest position can still be
// matched by label.

import { read, write } from './storage.js';

const KEY = 'channelTracks';
const MAX = 200;

function cleanTrack(track) {
  const out = {};
  if (Number.isInteger(track.audioIndex)) out.audioIndex = track.audioIndex;
  if (typeof track.audioLabel === 'string' && track.audioLabel) out.audioLabel = track.audioLabel.slice(0, 80);
  if (Number.isInteger(track.subtitleIndex)) out.subtitleIndex = track.subtitleIndex;
  if (typeof track.subtitleLabel === 'string' && track.subtitleLabel) out.subtitleLabel = track.subtitleLabel.slice(0, 80);
  return out;
}

export function loadChannelTracks() {
  const raw = read(KEY, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw;
}

export function saveChannelTrack(key, track) {
  if (!key) return;
  const map = loadChannelTracks();
  const clean = cleanTrack(track || {});
  if (Object.keys(clean).length) {
    // re-insert so the most recent channel ends up last for trimming
    delete map[key];
    map[key] = clean;
    const keys = Object.keys(map);
    if (keys.length > MAX) {
      for (const old of keys.slice(0, keys.length - MAX)) delete map[old];
    }
  } else {
    delete map[key];
  }
  write(KEY, map);
}

export function getChannelTrack(key) {
  if (!key) return null;
  const entry = loadChannelTracks()[key];
  return entry && typeof entry === 'object' ? entry : null;
}

export function clearChannelTracks() {
  write(KEY, {});
}

// Resolves a saved choice against the track list that is available right now.
// A valid index wins; otherwise the label is matched case-insensitively.
export function pickSavedTrack(list, saved) {
  if (!Array.isArray(list) || !saved) return null;
  if (Number.isInteger(saved.index) && saved.index >= 0 && saved.index < list.length) {
    return list[saved.index];
  }
  if (typeof saved.label === 'string' && saved.label) {
    const want = saved.label.toLowerCase();
    return list.find((track) => track.label && track.label.toLowerCase() === want) || null;
  }
  return null;
}
