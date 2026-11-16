
//





//







const COVER_RATIO = 0.9;



export function closeCatchupList(text, exp) {
  if (!exp || typeof text !== 'string' || text.indexOf('#EXTM3U') < 0) return text;
  if (/#EXT-X-STREAM-INF/i.test(text)) return text; 
  if (text.indexOf('#EXT-X-ENDLIST') >= 0) return text; 
  if (!(exp.dur > 0)) {
    try { console.log('[vod] keep live (unknown programme duration)'); } catch (e) {}
    return text;
  }
  let sum = 0;
  let n = 0;
  const re = /#EXTINF:\s*([\d.]+)/gi;
  let m;
  while ((m = re.exec(text))) {
    sum += parseFloat(m[1]) || 0;
    n++;
  }
  if (!n) return text;
  const cover = Math.round(sum) + '/' + Math.round(exp.dur) + 's';
  if (sum < exp.dur * COVER_RATIO) {
    
    try { console.log('[vod] keep live: covered ' + cover); } catch (e) {}
    return text;
  }
  try { console.log('[vod] closed list: ' + n + ' segs ' + cover); } catch (e) {}
  return text.replace(/\s*$/, '\n') + '#EXT-X-ENDLIST\n';
}



export function makeVodPlaylistLoader(base, getExpect) {
  return class VodPlaylistLoader extends base {
    load(context, config, callbacks) {
      const onSuccess = callbacks.onSuccess;
      const wrapped = Object.assign({}, callbacks, {
        onSuccess: (response, stats, ctx, networkDetails) => {
          try {
            response.data = closeCatchupList(response.data, getExpect());
          } catch (e) {}
          onSuccess(response, stats, ctx, networkDetails);
        }
      });
      super.load(context, config, wrapped);
    }
  };
}
