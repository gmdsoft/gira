// 화이트보드 커넥터 직각 길찾기 (GIRA-78)
// 원본 편집기는 요소를 옮기면 커넥터를 열 때 다시 그린다 — 저장된 경로(se#)는 마지막 배치 기준이라 낡을 수 있다.
// 그때는 붙은 면의 방향으로 나가고 들어오며, 다른 도형을 피하는 꺾은선을 찾는다.
//   격자 = 출발·도착 지점과 장애물 테두리(여백 포함) 좌표, 비용 = 길이 + 꺾임 벌점 (Dijkstra)
const STUB = 20, PAD = 16, BEND = 60, REACH = 400;

// 붙은 지점(sa/ta: 요소 안 비율 위치)에서 바깥으로 나가는 방향
export function anchorDirection(a) {
  if (!a || !Number.isFinite(a.left) || !Number.isFinite(a.top)) return null;
  const d = [[a.left, [-1, 0]], [1 - a.left, [1, 0]], [a.top, [0, -1]], [1 - a.top, [0, 1]]].sort((x, y) => x[0] - y[0]);
  return d[0][1];
}
// 방향을 모를 때: 상대 쪽으로 더 많이 가는 축
const toward = (from, to) => Math.abs(to[0] - from[0]) >= Math.abs(to[1] - from[1]) ? [Math.sign(to[0] - from[0]) || 1, 0] : [0, Math.sign(to[1] - from[1]) || 1];

export function simplify(points) {
  const p = points.filter((pt, k) => !k || Math.abs(pt[0] - points[k - 1][0]) > 1e-6 || Math.abs(pt[1] - points[k - 1][1]) > 1e-6);
  return p.filter((pt, k) => {
    if (!k || k === p.length - 1) return true;
    const [a, c] = [p[k - 1], p[k + 1]];
    return Math.abs((pt[0] - a[0]) * (c[1] - pt[1]) - (pt[1] - a[1]) * (c[0] - pt[0])) > 1e-6;
  });
}

// boxes: [{ x, y, w, h }] 피할 도형(출발·도착 요소는 빼고 넘긴다)
export function routeOrthogonal(start, end, startDir, endDir, boxes = []) {
  const ds = startDir ?? toward(start, end), de = endDir ?? toward(end, start);
  const s1 = [start[0] + ds[0] * STUB, start[1] + ds[1] * STUB], e1 = [end[0] + de[0] * STUB, end[1] + de[1] * STUB];
  const lo = [Math.min(s1[0], e1[0]) - REACH, Math.min(s1[1], e1[1]) - REACH], hi = [Math.max(s1[0], e1[0]) + REACH, Math.max(s1[1], e1[1]) + REACH];
  const inside = (pt, b) => pt[0] > b[0] + 1e-6 && pt[0] < b[2] - 1e-6 && pt[1] > b[1] + 1e-6 && pt[1] < b[3] - 1e-6;
  const obs = boxes.map((b) => [b.x - PAD, b.y - PAD, b.x + b.w + PAD, b.y + b.h + PAD])
    .filter((b) => b[2] > lo[0] && b[0] < hi[0] && b[3] > lo[1] && b[1] < hi[1] && !inside(s1, b) && !inside(e1, b));
  const uniq = (v) => [...new Set(v.map((x) => Math.round(x * 100) / 100))].sort((a, b) => a - b);
  const xs = uniq([s1[0], e1[0], (s1[0] + e1[0]) / 2, ...obs.flatMap((b) => [b[0], b[2]])]);
  const ys = uniq([s1[1], e1[1], (s1[1] + e1[1]) / 2, ...obs.flatMap((b) => [b[1], b[3]])]);
  const blocked = (pt) => obs.some((b) => inside(pt, b));
  const xi = xs.indexOf(Math.round(s1[0] * 100) / 100), yi = ys.indexOf(Math.round(s1[1] * 100) / 100);
  const gx = xs.indexOf(Math.round(e1[0] * 100) / 100), gy = ys.indexOf(Math.round(e1[1] * 100) / 100);
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const dirIndex = (d) => DIRS.findIndex((x) => x[0] === d[0] && x[1] === d[1]);
  const key = (i, j, d) => (i * ys.length + j) * 4 + d;
  const dist = new Map(), prev = new Map(), heap = [];
  const push = (c, k) => { heap.push([c, k]); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  const d0 = dirIndex(ds), dEnd = dirIndex([-de[0], -de[1]]);
  if (xi < 0 || yi < 0 || gx < 0 || gy < 0 || d0 < 0 || dEnd < 0) return null;
  const k0 = key(xi, yi, d0); dist.set(k0, 0); push(0, k0);
  let found = null;
  while (heap.length) {
    const [c, k] = pop(); if (c > (dist.get(k) ?? Infinity)) continue;
    const d = k % 4, cell = (k - d) / 4, i = Math.floor(cell / ys.length), j = cell % ys.length;
    if (i === gx && j === gy) { if (d === dEnd) { found = k; break; } const k2 = key(i, j, dEnd), c2 = c + BEND; if (c2 < (dist.get(k2) ?? Infinity)) { dist.set(k2, c2); prev.set(k2, k); push(c2, k2); } continue; }
    for (let nd = 0; nd < 4; nd++) {
      if (DIRS[nd][0] === -DIRS[d][0] && DIRS[nd][1] === -DIRS[d][1]) continue; // 되돌아가지 않는다
      const ni = i + DIRS[nd][0], nj = j + DIRS[nd][1];
      if (ni < 0 || nj < 0 || ni >= xs.length || nj >= ys.length) continue;
      const a = [xs[i], ys[j]], b = [xs[ni], ys[nj]];
      if (blocked(b) || blocked([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])) continue;
      const k2 = key(ni, nj, nd), c2 = c + Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]) + (nd === d ? 0 : BEND);
      if (c2 < (dist.get(k2) ?? Infinity)) { dist.set(k2, c2); prev.set(k2, k); push(c2, k2); }
    }
  }
  if (found == null) return null;
  const pts = [];
  for (let k = found; k != null; k = prev.get(k)) { const d = k % 4, cell = (k - d) / 4; pts.push([xs[Math.floor(cell / ys.length)], ys[cell % ys.length]]); }
  return simplify([start, ...pts.reverse(), end]);
}

// 경유점 커넥터: 사용자가 끌어 놓은 꺾임 선(axis 0 = 세로선 x, axis 1 = 가로선 y)은 지키고,
// 그 선에 닿기 전·후 구간만 도형을 피해 찾는다. 맞출 수 없으면 null (호출한 쪽이 예전 방식으로)
export function routeViaLine(start, end, ds, de, wp, boxes = []) {
  const ax = wp.axis === 1 ? 1 : 0, other = 1 - ax, at = wp.at[ax];
  const onLine = (pt) => { const q = [...pt]; q[ax] = at; return q; };
  // from 쪽을 향하는 선 방향 (도착 구간 = 바깥 방향, 출발 구간 = 나가는 방향)
  const away = (from, to) => { const d = [0, 0]; d[other] = Math.sign(from[other] - to[other]) || 1; return d; };
  // 도착 쪽이 선과 같은 축으로 들어오면: 선 위의 점까지 길찾기 + 곧게 도착
  if (de && de[ax] && (end[ax] - at) * -de[ax] > 0) {
    const mid = onLine(end), leg = routeOrthogonal(start, mid, ds, away(start, mid), boxes);
    return leg && simplify([...leg, end]);
  }
  // 출발 쪽이 선과 같은 축으로 나가면: 곧게 선까지 + 선 위의 점에서 길찾기
  if (ds && ds[ax] && (at - start[ax]) * ds[ax] > 0) {
    const mid = onLine(start), leg = routeOrthogonal(mid, end, away(end, mid), de, boxes);
    return leg && simplify([start, ...leg]);
  }
  return null;
}
