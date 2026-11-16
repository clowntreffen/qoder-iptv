


export function makeRanges(list) {
  const arr = list.slice();
  const check = (i) => {
    if (!(i >= 0 && i < arr.length)) {
      const e = new Error('Index ' + i + ' out of range');
      e.name = 'IndexSizeError';
      throw e;
    }
  };
  return {
    length: arr.length,
    start(i) {
      check(i);
      return arr[i][0];
    },
    end(i) {
      check(i);
      return arr[i][1];
    }
  };
}

export function scaleRanges(tr, k) {
  const out = [];
  if (tr) for (let i = 0; i < tr.length; i++) out.push([tr.start(i) * k, tr.end(i) * k]);
  return makeRanges(out);
}


export function addRange(list, s, e, tol = 0) {
  if (!(e > s)) return list.slice();
  const out = [];
  let cs = s;
  let ce = e;
  let placed = false;
  for (const [a, b] of list) {
    if (b + tol < cs) {
      out.push([a, b]);
    } else if (a - tol > ce) {
      if (!placed) {
        out.push([cs, ce]);
        placed = true;
      }
      out.push([a, b]);
    } else {
      cs = Math.min(cs, a);
      ce = Math.max(ce, b);
    }
  }
  if (!placed) out.push([cs, ce]);
  return out;
}

export function removeRange(list, s, e) {
  const out = [];
  for (const [a, b] of list) {
    if (b <= s || a >= e) {
      out.push([a, b]);
      continue;
    }
    if (a < s) out.push([a, s]);
    if (b > e) out.push([e, b]);
  }
  return out;
}
