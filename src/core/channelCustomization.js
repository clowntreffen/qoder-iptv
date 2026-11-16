// Per-channel overrides: rename, hide, EPG offset, group, and manual order.
// The channel key stays derived from the playlist (group|title), so overrides
// keep matching after a source refresh.

const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);

export function normalizeOverrides(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, ov] of Object.entries(raw)) {
    if (!key || RESERVED.has(key) || !ov || typeof ov !== 'object') continue;
    const clean = {};
    if (typeof ov.name === 'string' && ov.name.trim()) clean.name = ov.name.trim();
    if (ov.hidden === true) clean.hidden = true;
    if (Number.isFinite(ov.epgOffsetMinutes) && ov.epgOffsetMinutes !== 0) {
      clean.epgOffsetMinutes = Math.round(ov.epgOffsetMinutes);
    }
    if (typeof ov.group === 'string' && ov.group.trim()) clean.group = ov.group.trim();
    // Any finite number works as a sort rank; the editor writes fractional
    // values between neighbours so a move never has to renumber the list.
    if (Number.isFinite(ov.order)) clean.order = ov.order;
    if (Object.keys(clean).length) out[key] = clean;
  }
  return out;
}

export function getOverride(map, key) {
  if (!map || !key) return null;
  const ov = map[key];
  return ov && typeof ov === 'object' ? ov : null;
}


export function patchOverride(map, key, patch) {
  if (!key) return map;
  const next = { ...((map && map[key]) || {}) };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v === null || v === undefined || v === '' || v === false) delete next[k];
    else next[k] = v;
  }
  const clean = normalizeOverrides({ [key]: next });
  const out = { ...map };
  if (clean[key]) out[key] = clean[key];
  else delete out[key];
  return out;
}

export function clearOverride(map, key) {
  if (!key || !map || !(key in map)) return map;
  const out = { ...map };
  delete out[key];
  return out;
}


function rankOf(ch, index, map) {
  const ov = map && map[ch.key];
  return ov && Number.isFinite(ov.order) ? ov.order : index;
}

// Stable sort of one group's channels by their override rank (or playlist
// position when there is no override).
export function sortGroup(list, map) {
  return (list || [])
    .map((ch, index) => ({ ch, index, rank: rankOf(ch, index, map) }))
    .sort((a, b) => (a.rank - b.rank) || (a.index - b.index))
    .map((e) => e.ch);
}

// Rebuilds the flat channel array group by group, each group sorted by rank.
// Groups keep their first-seen order so regrouping alone does not reshuffle
// unrelated groups.
export function orderChannels(channels, map) {
  if (!channels || !channels.length) return channels || [];
  const groups = new Map();
  channels.forEach((ch, index) => {
    if (!groups.has(ch.group)) groups.set(ch.group, []);
    groups.get(ch.group).push({ ch, index });
  });
  const out = [];
  for (const list of groups.values()) {
    const ranked = list
      .map((e) => ({ ...e, rank: rankOf(e.ch, e.index, map) }))
      .sort((a, b) => (a.rank - b.rank) || (a.index - b.index));
    for (const e of ranked) out.push(e.ch);
  }
  return out;
}

// Moves a channel one slot up/down inside its group. Ranks are written as a
// value between the two new neighbours, so the rest of the group keeps its
// position and only one override is stored.
export function moveChannel(map, list, key, dir) {
  if (!key || !dir) return map;
  const sorted = sortGroup(list, map);
  const from = sorted.findIndex((ch) => ch.key === key);
  if (from < 0) return map;
  const to = from + dir;
  if (to < 0 || to >= sorted.length) return map;
  const rest = sorted.filter((_, idx) => idx !== from);
  const prev = rest[to - 1];
  const next = rest[to];
  const prevRank = prev ? rankOf(prev, list.indexOf(prev), map) : null;
  const nextRank = next ? rankOf(next, list.indexOf(next), map) : null;
  let rank;
  if (prevRank != null && nextRank != null) rank = (prevRank + nextRank) / 2;
  else if (nextRank != null) rank = nextRank - 1;
  else if (prevRank != null) rank = prevRank + 1;
  else rank = 0;
  return patchOverride(map, key, { order: rank });
}


// Applies the override map to freshly parsed channels. Originals are kept on
// the channel so clearing an override in the editor restores the playlist
// value without a source refresh.
export function applyChannelOverrides(channels, map) {
  if (!channels || !channels.length) return channels || [];
  for (const ch of channels) {
    if (ch.baseName === undefined) ch.baseName = ch.name;
    if (ch.baseGroup === undefined) ch.baseGroup = ch.group;
    const ov = map ? map[ch.key] : null;
    ch.name = ov && ov.name ? ov.name : ch.baseName;
    ch.group = ov && ov.group ? ov.group : ch.baseGroup;
    ch.customHidden = !!(ov && ov.hidden === true);
    ch.epgOffsetMinutes = (ov && ov.epgOffsetMinutes) || 0;
  }
  return channels;
}
