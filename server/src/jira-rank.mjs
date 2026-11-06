// Local fractional ranks use printable ASCII and bytewise (PostgreSQL C) ordering.
// Imported LexoRank strings remain unchanged; local extensions retain their bucket.
export const RANK_COLUMN = 'i.rank COLLATE "C"';
export const RANK_ORDER = `${RANK_COLUMN} ASC NULLS LAST, i.issue_key ASC`;
export function rankBetween(lower, upper) {
  if (lower != null && upper != null && lower >= upper) throw new Error('순위 사이에 공간이 없습니다');
  const bucket = (lower ?? upper ?? '0|').slice(0, 2);
  for (const rank of [lower, upper]) {
    if (rank != null && !/^[012]\|[!-~]+$/.test(rank)) throw new Error('지원하지 않는 순위 형식입니다');
  }
  let a = lower?.slice(2) ?? '';
  let b = upper?.startsWith(bucket) ? upper.slice(2) : null;
  let out = bucket;
  for (;;) {
    let i = 0;
    while (i < a.length && b != null && a[i] === b[i]) { out += a[i]; i++; }
    a = a.slice(i); b = b == null ? null : b.slice(i);
    const lo = a.length ? a.charCodeAt(0) : 32;
    const hi = b == null ? 127 : b.length ? b.charCodeAt(0) : 32;
    if (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      return out + String.fromCharCode(mid) + (mid === 33 ? 'O' : '');
    }
    if (!a.length) {
      if (!b?.length) throw new Error('순위 사이에 공간이 없습니다');
      out += b[0]; a = ''; b = b.slice(1);
    } else {
      out += a[0]; a = a.slice(1); b = null;
    }
  }
}
