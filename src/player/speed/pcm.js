






export class PcmStore {
  constructor() {
    this.reset();
  }

  reset() {
    this.sr = 0;
    this.ch = 0;
    this.blocks = []; 
  }

  get empty() {
    return !this.blocks.length;
  }

  
  get seconds() {
    if (!this.sr) return 0;
    let n = 0;
    for (const b of this.blocks) n += b.n;
    return n / this.sr;
  }

  insert(startSec, data, sr) {
    if (!data || !data.length || !data[0].length) return;
    
    if (this.sr && (sr !== this.sr || data.length !== this.ch)) this.reset();
    if (!this.sr) {
      this.sr = sr;
      this.ch = data.length;
    }
    const s0 = Math.round(startSec * sr);
    const n = data[0].length;
    const e = s0 + n;
    const list = this.blocks;
    
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      if (b.s0 >= s0 && b.s0 + b.n <= e) list.splice(i, 1);
    }
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].s0 <= s0) lo = mid + 1;
      else hi = mid;
    }
    list.splice(lo, 0, { s0, n, data });
  }

  
  removeSec(a, b) {
    if (!this.sr) return;
    const sa = a * this.sr;
    const sb = b * this.sr;
    this.blocks = this.blocks.filter((blk) => {
      const mid = blk.s0 + blk.n / 2;
      return mid < sa || mid >= sb;
    });
  }

  
  _first(s) {
    const list = this.blocks;
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].s0 <= s) lo = mid + 1;
      else hi = mid;
    }
    let i = Math.max(0, lo - 1);
    while (i > 0 && list[i - 1].s0 + list[i - 1].n > s) i--;
    return i;
  }

  



  contiguousEnd(s, tol) {
    const list = this.blocks;
    if (!list.length) return s;
    const gap = tol != null ? tol : Math.round(this.sr * 0.05);
    let end = s;
    let covered = false;
    for (let i = this._first(s); i < list.length; i++) {
      const b = list[i];
      if (b.s0 + b.n <= s) continue;
      if (b.s0 > end + (covered ? gap : 0)) break;
      covered = true;
      if (b.s0 + b.n > end) end = b.s0 + b.n;
    }
    return end;
  }

  
  read(s, n, out) {
    for (let c = 0; c < out.length; c++) out[c].fill(0, 0, n);
    const list = this.blocks;
    const e = s + n;
    for (let i = this._first(s); i < list.length; i++) {
      const b = list[i];
      if (b.s0 >= e) break;
      const be = b.s0 + b.n;
      if (be <= s) continue;
      const from = Math.max(s, b.s0);
      const to = Math.min(e, be);
      for (let c = 0; c < out.length; c++) {
        const src = b.data[Math.min(c, b.data.length - 1)];
        out[c].set(src.subarray(from - b.s0, to - b.s0), from - s);
      }
    }
  }

  
  readMono(s, n, out, tmp) {
    this.read(s, n, tmp);
    const ch = tmp.length;
    if (ch === 1) {
      out.set(tmp[0].subarray(0, n));
      return;
    }
    for (let i = 0; i < n; i++) {
      let v = 0;
      for (let c = 0; c < ch; c++) v += tmp[c][i];
      out[i] = v / ch;
    }
  }

  
  evictBefore(sec) {
    if (!this.sr) return null;
    const s = sec * this.sr;
    let cut = 0;
    while (cut < this.blocks.length && this.blocks[cut].s0 + this.blocks[cut].n <= s) cut++;
    if (!cut) return null;
    const from = this.blocks[0].s0 / this.sr;
    const last = this.blocks[cut - 1];
    this.blocks.splice(0, cut);
    return [from, (last.s0 + last.n) / this.sr];
  }
}










export class Wsola {
  constructor(store, speed) {
    this.store = store;
    this.speed = speed;
    this.sr = 0;
  }

  _setup() {
    const sr = this.store.sr;
    const ch = this.store.ch;
    this.sr = sr;
    this.ch = ch;
    
    const N = 2 * Math.round(sr * 0.02);
    const Hs = N / 2;
    this.N = N;
    this.Hs = Hs;
    this.D = Math.round(sr * 0.01);
    this.Ha = Hs * this.speed;
    
    this.win = new Float32Array(N);
    for (let i = 0; i < N; i++) this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
    this.acc = [];
    this.frame = [];
    this.tmp = [];
    for (let c = 0; c < ch; c++) {
      this.acc.push(new Float32Array(N));
      this.frame.push(new Float32Array(N + 2 * this.D + Hs));
      this.tmp.push(new Float32Array(N + 2 * this.D + Hs));
    }
    this.seg = new Float32Array(N + 2 * this.D + Hs);
    this.tpl = new Float32Array(Hs);
  }

  
  reset(pos) {
    if (this.sr !== this.store.sr || this.ch !== this.store.ch || !this.win) this._setup();
    for (const a of this.acc) a.fill(0);
    this.a = pos;
    this.prevP = -1;
  }

  
  get pos() {
    return this.a;
  }

  
  nudge(samples) {
    this.a += samples;
  }

  
  ready(hops) {
    const need = Math.ceil(this.a + hops * this.Ha) + this.D + this.N;
    return this.store.contiguousEnd(Math.max(0, Math.round(this.a))) >= need;
  }

  



  process(hops) {
    if (!this.win || !this.ready(hops)) return null;
    const out = [];
    for (let c = 0; c < this.ch; c++) out.push(new Float32Array(hops * this.Hs));
    for (let h = 0; h < hops; h++) this._hop(out, h * this.Hs);
    return out;
  }

  _hop(out, off) {
    const { N, Hs, win, acc, frame, ch } = this;
    const base = Math.round(this.a);
    const p = this.prevP >= 0 ? this._search(base, this.prevP + Hs) : base;
    this.store.read(p, N, frame);
    for (let c = 0; c < ch; c++) {
      const a = acc[c];
      const f = frame[c];
      for (let i = 0; i < N; i++) a[i] += f[i] * win[i];
      out[c].set(a.subarray(0, Hs), off);
      a.copyWithin(0, Hs);
      a.fill(0, N - Hs);
    }
    this.prevP = p;
    this.a += this.Ha;
  }

  




  _search(base, tplPos) {
    const { Hs, D, seg, tpl, tmp } = this;
    const L = Hs;
    const len = 2 * D + L;
    this.store.readMono(base - D, len, seg, tmp);
    this.store.readMono(tplPos, L, tpl, tmp);
    let te = 0;
    for (let j = 0; j < L; j += 4) te += tpl[j] * tpl[j];
    if (te < 1e-9) return base; 
    const score = (k, step) => {
      let xy = 0;
      let xx = 0;
      for (let j = 0; j < L; j += step) {
        const x = seg[k + j];
        xy += x * tpl[j];
        xx += x * x;
      }
      return xx > 1e-12 ? xy / Math.sqrt(xx) : -Infinity;
    };
    let best = D;
    let bestS = -Infinity;
    for (let k = 0; k <= 2 * D; k += 4) {
      const s = score(k, 4);
      if (s > bestS) {
        bestS = s;
        best = k;
      }
    }
    const lo = Math.max(0, best - 3);
    const hi = Math.min(2 * D, best + 3);
    bestS = -Infinity;
    let fine = best;
    for (let k = lo; k <= hi; k++) {
      const s = score(k, 1);
      if (s > bestS) {
        bestS = s;
        fine = k;
      }
    }
    return base - D + fine;
  }
}
