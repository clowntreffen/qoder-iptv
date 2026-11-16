// 频道级自定义（按 ch.key，跨源刷新稳定）：改名、单频道隐藏、EPG 分钟偏移。
// 源刷新重建 ch 对象后重放即可：只读 override，不写回源的原始字段。

export function normalizeOverrides(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, ov] of Object.entries(raw)) {
    if (!key || !ov || typeof ov !== 'object') continue;
    const clean = {};
    if (typeof ov.name === 'string' && ov.name.trim()) clean.name = ov.name.trim();
    if (ov.hidden === true) clean.hidden = true;
    if (Number.isFinite(ov.epgOffsetMinutes) && ov.epgOffsetMinutes !== 0) {
      clean.epgOffsetMinutes = Math.round(ov.epgOffsetMinutes);
    }
    if (Object.keys(clean).length) out[key] = clean;
  }
  return out;
}

export function getOverride(map, key) {
  if (!map || !key) return null;
  const ov = map[key];
  return ov && typeof ov === 'object' ? ov : null;
}

// patch: { name?, hidden?, epgOffsetMinutes? }；null/''/false 删除该字段。
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

// 重放到解析后的频道：改名 → ch.name；隐藏 → ch.customHidden；偏移 → ch.epgOffsetMinutes。
// 幂等前提：每次都对 freshly parsed 的 ch 调用（override 删掉后下次解析自然复原）。
export function applyChannelOverrides(channels, map) {
  if (!channels || !channels.length) return channels || [];
  if (!map) return channels;
  for (const ch of channels) {
    const ov = map[ch.key];
    if (!ov) continue;
    if (ov.name) ch.name = ov.name;
    ch.customHidden = ov.hidden === true;
    ch.epgOffsetMinutes = ov.epgOffsetMinutes || 0;
  }
  return channels;
}
