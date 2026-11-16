
//









function lunaCall(uri, params, timeoutMs = 2500) {
  return new Promise((resolve) => {
    let bridge;
    try {
      bridge = new window.PalmServiceBridge();
    } catch (e) {
      resolve({ ok: false, err: 'no-bridge' });
      return;
    }
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      
      bridge = null;
      resolve(v);
    };
    const timer = setTimeout(() => finish({ ok: false, err: 'timeout' }), timeoutMs);
    bridge.onservicecallback = (msg) => {
      try {
        const j = JSON.parse(msg);
        
        
        if (j && j.returnValue === false) {
          finish({ ok: false, err: j.errorText || 'returnValue=false', raw: j });
          return;
        }
        finish({ ok: true, data: j });
      } catch (e) {
        finish({ ok: false, err: 'bad-json' });
      }
    };
    try {
      bridge.call(uri, JSON.stringify(params || {}));
    } catch (e) {
      finish({ ok: false, err: 'call-throw' });
    }
  });
}

function normMac(v) {
  if (!v || typeof v !== 'string') return '';
  const s = v.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  
  if (s.length !== 12 || /^0+$/.test(s)) return '';
  return s;
}


//




const MAC_RE = /^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/;

function scanMacs(node, path, out, depth) {
  if (!node || depth > 6) return;
  if (typeof node === 'string') {
    if (MAC_RE.test(node.trim())) {
      const m = normMac(node);
      if (m) out.push({ path, mac: m });
    }
    return;
  }
  if (typeof node !== 'object') return;
  for (const k of Object.keys(node)) {
    scanMacs(node[k], path ? path + '.' + k : k, out, depth + 1);
  }
}



function brief(obj, max = 260) {
  let s;
  try {
    s = typeof obj === 'string' ? obj : JSON.stringify(obj);
  } catch (e) {
    s = String(obj);
  }
  if (!s) return '';
  return s.length > max ? s.slice(0, max) + '…' : s;
}


function cleanId(v) {
  if (!v || typeof v !== 'string') return '';
  const s = v.trim();
  if (!s || s.length < 4) return '';
  if (/^(unknown|n\/a|none|null|undefined|0+)$/i.test(s)) return '';
  return s;
}




export async function collectDevice() {
  const out = {
    serial: '',
    serialFrom: '',
    wiredMac: '',
    wifiMac: '',
    macPath: '', 
    netErr: '',
    model: '',
    firmware: '',
    sysErr: '',
    probes: [], 
    ua: ''
  };

  const probe = async (name, uri, params) => {
    const r = await lunaCall(uri, params);
    out.probes.push({
      name,
      ok: !!r.ok,
      err: r.ok ? '' : r.err || 'unknown',
      text: r.ok ? brief(r.data) : brief(r.raw || '')
    });
    return r;
  };

  
  
  
  
  const ser = await probe(
    'systemproperty serialNumber',
    'luna://com.webos.service.tv.systemproperty/getSystemInfo',
    { keys: ['serialNumber'] }
  );
  if (ser.ok) {
    const v = cleanId((ser.data || {}).serialNumber);
    if (v) {
      out.serial = v;
      out.serialFrom = 'systemproperty';
    }
  }

  
  const net = await probe('connectionmanager getinfo', 'luna://com.webos.service.connectionmanager/getinfo', {});
  const macs = [];
  if (net.ok) scanMacs(net.data, '', macs, 0);
  else out.netErr = net.err || 'unknown';

  
  if (!macs.length) {
    const st = await probe('connectionmanager getStatus', 'luna://com.webos.service.connectionmanager/getStatus', {});
    if (st.ok) scanMacs(st.data, '', macs, 0);
  }

  for (const m of macs) {
    const p = m.path.toLowerCase();
    if (!out.wiredMac && /wired|eth/.test(p)) { out.wiredMac = m.mac; out.macPath = m.path; }
    else if (!out.wifiMac && /wifi|wlan/.test(p)) { out.wifiMac = m.mac; if (!out.macPath) out.macPath = m.path; }
  }
  
  
  if (!out.wiredMac && !out.wifiMac && macs.length) {
    out.wiredMac = macs[0].mac;
    out.macPath = macs[0].path;
  }

  
  
  const ids = await probe('sm deviceid getIDs', 'luna://com.webos.service.sm/deviceid/getIDs', {
    idType: ['LGUDID']
  });
  if (ids.ok && !out.serial) {
    const arr = (ids.data || {}).idList;
    if (Array.isArray(arr) && arr.length) {
      const v = cleanId(arr[0].idValue || arr[0].value);
      if (v) { out.serial = v; out.serialFrom = 'LGUDID'; }
    }
  }

  
  const sys = await lunaCall('luna://com.webos.service.tv.systemproperty/getSystemInfo', {
    keys: ['modelName', 'firmwareVersion', 'sdkVersion']
  });
  if (sys.ok) {
    const d = sys.data || {};
    out.model = d.modelName || '';
    out.firmware = d.firmwareVersion || d.sdkVersion || '';
  } else {
    out.sysErr = sys.err || 'unknown';
    
    try {
      const pd = JSON.parse(window.PalmSystem.deviceInfo);
      out.model = out.model || pd.modelName || '';
      out.firmware = out.firmware || pd.platformVersion || '';
    } catch (e) {}
  }

  try { out.ua = navigator.userAgent || ''; } catch (e) {}
  return out;
}




export function probeMseHevcLevels() {
  const levels = [
    ['L120', 'hvc1.1.6.L120.90'],
    ['L123', 'hvc1.1.6.L123.B0'],
    ['L150', 'hvc1.1.6.L150.90']
  ];
  const mse = typeof MediaSource !== 'undefined' ? MediaSource : null;
  return levels.map(([tag, codec]) => {
    let mime = '';
    if (mse && typeof mse.isTypeSupported === 'function') {
      for (const c of [codec, codec.replace(/^hvc1/, 'hev1')]) {
        try {
          if (mse.isTypeSupported('video/mp4; codecs="' + c + '"')) { mime = c; break; }
        } catch (e) {}
      }
    }
    return { tag, mime };
  });
}
