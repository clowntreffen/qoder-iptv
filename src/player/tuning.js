
//



//


//


import { read, write } from '../core/storage.js';
import { t } from '../core/i18n.js';

const KEY = 'hlsTuning';

const onOff = (v) => (v ? t('label.on') : t('label.off'));



export const TUNING_SPECS = [
  {
    key: 'liveSyncDuration',
    values: [8, 12, 16, 20, 22, 26, 30, 40, 50],
    def: 12,
    fmt: (v) => v + 's'
  },
  {
    key: 'startOnSegmentBoundary',
    values: [true, false],
    def: true,
    fmt: onOff
  },
  
  
  
  
  
  
  
  
  
  
  
  {
    key: 'prefetchSegmentBytes',
    values: [0, 2097152, 4194304, 8388608, 16777216, 33554432, 67108864],
    def: 8388608,
    app: true,
    fmt: (v) => (v === 0 ? t('label.off') : v / 1048576 + ' MB')
  },
  {
    key: 'prefetchStartBuffer',
    values: [2, 3, 5, 8, 10, 15, 20],
    def: 5,
    app: true,
    warm: true,
    fmt: (v) => v + 's'
  },
  {
    key: 'prefetchHoldBuffer',
    values: [1, 2, 3, 5, 8, 10],
    def: 3,
    app: true,
    warm: true,
    fmt: (v) => v + 's'
  },
  {
    key: 'prefetchAdaptive',
    values: [true, false],
    def: true,
    app: true,
    warm: true,
    fmt: onOff
  },
  
  
  
  
  
  
  
  
  
  
  
  
  {
    key: 'fragParallel',
    values: [0, 2, 3, 4, 6],
    def: 6,
    app: true,
    fmt: (v) => (v === 0 ? t('label.off') : v + t('tune.lanes'))
  },
  {
    key: 'maxBufferLength',
    values: [10, 15, 20, 30, 45, 60],
    def: 30,
    fmt: (v) => v + 's'
  },
  {
    key: 'backBufferLength',
    values: [0, 5, 10, 30, 60, 90],
    def: 30,
    fmt: (v) => v + 's'
  },
  {
    key: 'abrEwmaDefaultEstimate',
    values: [1000000, 1500000, 3000000, 6000000, 10000000, 20000000, 40000000],
    def: 1500000,
    fmt: (v) => (v / 1000000).toFixed(v % 1000000 ? 1 : 0) + ' Mbps'
  },
  {
    key: 'startFragPrefetch',
    values: [true, false],
    def: true,
    fmt: onOff
  },
  {
    key: 'fragLoadingTimeOut',
    values: [8000, 15000, 20000, 30000, 45000, 60000],
    def: 15000,
    fmt: (v) => v / 1000 + 's'
  },
  {
    key: 'fragLoadingMaxRetry',
    values: [1, 2, 3, 5, 8],
    def: 3,
    fmt: (v) => String(v)
  },
  {
    key: 'liveSyncOnStallIncrease',
    values: [0, 1, 2, 3, 5],
    def: 0,
    fmt: (v) => v + 's'
  },
  {
    key: 'enableWorker',
    values: [true, false],
    def: true,
    fmt: onOff
  }
];

const SPEC_BY_KEY = TUNING_SPECS.reduce((m, s) => ((m[s.key] = s), m), {});

export function defaultTuning() {
  return TUNING_SPECS.reduce((o, s) => ((o[s.key] = s.def), o), {});
}



function normalizeTuning(saved) {
  const out = defaultTuning();
  for (const s of TUNING_SPECS) {
    if (s.values.indexOf(saved[s.key]) >= 0) out[s.key] = saved[s.key];
  }
  const holdValues = SPEC_BY_KEY.prefetchHoldBuffer.values.filter((v) => v < out.prefetchStartBuffer);
  out.prefetchHoldBuffer = Math.min(out.prefetchHoldBuffer, holdValues[holdValues.length - 1]);
  return out;
}

export function getTuning() {
  return normalizeTuning(read(KEY, {}) || {});
}

export function saveTuning(obj) {
  const tuning = normalizeTuning(obj);
  write(KEY, tuning);
  return tuning;
}

export function resetTuning() {
  const d = defaultTuning();
  saveTuning(d);
  return d;
}


export function isAllDefault(tuning) {
  return TUNING_SPECS.every((s) => tuning[s.key] === s.def);
}


export function cycleValue(key, cur, dir, tuning) {
  const s = SPEC_BY_KEY[key];
  if (!s) return cur;
  const values = key === 'prefetchHoldBuffer' && tuning
    ? s.values.filter((v) => v < tuning.prefetchStartBuffer)
    : s.values;
  const i = values.indexOf(cur);
  const base = i < 0 ? Math.max(0, values.indexOf(s.def)) : i;
  return values[(base + dir + values.length) % values.length];
}

export function formatValue(key, v) {
  const s = SPEC_BY_KEY[key];
  return s ? s.fmt(v) : String(v);
}




export function toHlsConfig(tuning) {
  const t2 = tuning || getTuning();
  const out = {};
  for (const s of TUNING_SPECS) {
    if (s.app) continue;
    if (t2[s.key] !== undefined) out[s.key] = t2[s.key];
  }
  return out;
}
