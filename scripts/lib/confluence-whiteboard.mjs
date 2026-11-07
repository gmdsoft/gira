import { decodeCanvas } from '../research/canvas-decode.mjs';

const bytes = v => v && typeof v === 'object' ? Uint8Array.from(Object.values(v)) : null;
const pair = v => v && [Number(v[0]), Number(v[1])].every(Number.isFinite) ? [Number(v[0]), Number(v[1])] : null;
export function canvasColor(v, fallback = 'none') {
  const b = bytes(v);
  if (!b || b.length < 12) return fallback;
  const view = new DataView(b.buffer);
  const rgb = [0, 4, 8].map(i => Math.max(0, Math.min(255, Math.round(view.getFloat32(i)))));
  return rgb.every(Number.isFinite) ? `rgb(${rgb.join(',')})` : fallback;
}
// 리치 텍스트(tx·ti) 바이너리 — 원본 화이트보드 편집기의 문서 트리 직렬화 (2026-11-07 33개 보드 1,823개 값 모두 해석 확인)
//   머리 [0][1][블록 수] 다음 노드가 이어진다. 노드 = [종류][자식 수][속성…][자식…]
//   종류: 1 문단(속성 1바이트: 0) · 11 제목(속성: 수준 1~6) · 2 글머리 목록 · 3 목록 항목 · 10 번호 목록(속성: varint + 1바이트)
//         4 글자 [varint 길이][UTF-8][마크 수][마크…] · 16 줄바꿈 · 9 이모지 [varint 길이][짧은 이름][varint 길이][이모지 글자]
//   마크: 5 굵게 · 6 기울임 · 15 취소선(원본 화면 '…/ 완료' 항목으로 확인) · 13 링크 [1바이트][varint 길이][msgpack {href}]
//   글자 색·크기 마크는 없다 — 색은 요소의 c, 크기는 요소의 글자 배율(fs#). 제목 수준은 상자 크기에 영향이 없어(원본 bs# 높이 동일) 굵게만 표시한다.
export function parseCanvasRichText(v) {
  const b = bytes(v); if (!b) return null;
  let i = 0;
  const byte = () => { if (i >= b.length) throw new Error('eof'); return b[i++]; };
  const varint = () => { let x = 0, s = 0; for (;;) { const n = byte(); x += (n & 127) * 2 ** s; s += 7; if (!(n & 128)) return x; if (s > 35) throw new Error('varint'); } };
  const str = () => { const len = varint(); if (i + len > b.length) throw new Error('eof'); const t = new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(i, i + len)); i += len; return t; };
  const marks = () => {
    const out = {}, n = byte();
    for (let k = 0; k < n; k++) {
      const t = byte();
      if (t === 5) out.b = true; else if (t === 6) out.i = true; else if (t === 15) out.s = true;
      else if (t === 13) { byte(); const len = varint(); const raw = new TextDecoder().decode(b.subarray(i, i + len)); i += len; const href = raw.match(/https?:\/\/[^\x00-\x20"\x7f-\x9f\ufffd]+/)?.[0]; if (href) out.href = href; }
      else throw new Error('mark ' + t);
    }
    return out;
  };
  const node = (depth) => {
    if (depth > 20) throw new Error('depth');
    const t = byte();
    if (t === 4) { const text = str(); return { t: 'text', text, ...marks() }; }
    if (t === 16) return { t: 'br' };
    if (t === 9) { str(); return { t: 'text', text: str() }; }
    const n = byte(); let attr = null;
    if (t === 1 || t === 11) attr = byte();
    else if (t === 10) { varint(); byte(); }
    else if (t !== 2 && t !== 3) throw new Error('node ' + t);
    const children = []; for (let k = 0; k < n; k++) children.push(node(depth + 1));
    return { t, attr, children };
  };
  try {
    if (byte() !== 0 || byte() !== 1) return null;
    const n = byte(), blocks = []; for (let k = 0; k < n; k++) blocks.push(node(0));
    return i === b.length ? blocks : null;
  } catch { return null; }
}
// 트리 → 줄 목록 [{ heading, list: 'ul'|'ol', depth, n, runs: [{ text, b, i, s, href }] }]
export function richLines(blocks) {
  const lines = [];
  const inline = (nodes, line) => { for (const c of nodes) { if (c.t === 'text') { const { t, ...run } = c; line.runs.push(run); } else if (c.t === 'br') line.runs.push({ text: '\n' }); } };
  const walk = (nodes, list, depth) => nodes.forEach((nd, idx) => {
    if (nd.t === 1 || nd.t === 11) { const line = { runs: [] }; if (nd.t === 11) line.heading = nd.attr; inline(nd.children, line); lines.push(line); }
    else if (nd.t === 2 || nd.t === 10) walk(nd.children, nd.t === 2 ? 'ul' : 'ol', list ? depth + 1 : 0);
    else if (nd.t === 3) {
      const first = lines.length;
      walk(nd.children, list, depth);
      if (lines[first]) Object.assign(lines[first], { list, depth, n: idx + 1 });
    }
  });
  walk(blocks, null, 0);
  return lines;
}
const plainLines = (lines) => lines.map((l) => l.runs.map((r) => r.text).join('')).join('\n');
// 서식(굵게·기울임·취소선·링크·목록·제목)이 하나라도 있을 때만 줄 목록을 남긴다 — 일반 글자는 text만으로 충분
export function canvasRich(v) {
  const blocks = parseCanvasRichText(v); if (!blocks) return null;
  const lines = richLines(blocks);
  return lines.some((l) => l.list || l.heading || l.runs.some((r) => r.b || r.i || r.s || r.href)) ? lines : null;
}
// 해석이 안 되는 값은 길이 붙은 UTF-8 조각(태그 4)만 골라 이어 붙인다 (예전 방식)
export function canvasText(v) {
  if (typeof v === 'string') return v;
  const b = bytes(v); if (!b) return '';
  const blocks = parseCanvasRichText(b);
  if (blocks) return plainLines(richLines(blocks));
  const runs = [];
  let lastEnd = -1;
  for (let i = 0; i < b.length; i++) {
    if (b[i] !== 4) continue;
    let length = 0, shift = 0, p = i + 1;
    while (p < b.length && shift < 35) { const n = b[p++]; length += (n & 127) * 2 ** shift; shift += 7; if (!(n & 128)) break; }
    if (!length || p + length > b.length) continue;
    try { const s = new TextDecoder('utf-8', { fatal: true }).decode(b.slice(p, p + length));
      if (!/[\x00-\x08\x0b-\x1f]/.test(s)) {
        // 앞 조각과의 사이에 블록 끝 표시(0 또는 1)가 있으면 다른 문단·목록 항목 → 줄바꿈 (같은 문단 안 서식 바뀜은 그냥 이어 붙임)
        if (runs.length && b.subarray(lastEnd, i).some((x) => x === 0 || x === 1)) runs.push('\n');
        runs.push(s); i = p + length - 1; lastEnd = p + length;
      }
    } catch { /* not a text run */ }
  }
  return runs.join('');
}
// 꺾은선의 모서리를 둥글게 (원본 커넥터처럼 반지름 8, 짧은 구간은 그 절반까지)
export function roundedPath(points, radius = 8) {
  const p = points.filter((pt, k) => !k || pt[0] !== points[k - 1][0] || pt[1] !== points[k - 1][1]);
  if (p.length < 3) return p.map((pt, k) => `${k ? 'L' : 'M'} ${pt[0]} ${pt[1]}`).join(' ');
  const out = [`M ${p[0][0]} ${p[0][1]}`];
  for (let k = 1; k < p.length - 1; k++) {
    const [a, c, d] = [p[k - 1], p[k], p[k + 1]];
    const l1 = Math.hypot(c[0] - a[0], c[1] - a[1]), l2 = Math.hypot(d[0] - c[0], d[1] - c[1]);
    const r = Math.min(radius, l1 / 2, l2 / 2);
    const cross = (c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0]);
    if (r < 0.5 || Math.abs(cross) < 1e-6) { out.push(`L ${c[0]} ${c[1]}`); continue; }
    const q = (from, to, len) => [to[0] + (from[0] - to[0]) * r / len, to[1] + (from[1] - to[1]) * r / len].map((x) => Math.round(x * 100) / 100);
    const s = q(a, c, l1), e = q(d, c, l2);
    out.push(`L ${s[0]} ${s[1]}`, `Q ${c[0]} ${c[1]} ${e[0]} ${e[1]}`);
  }
  out.push(`L ${p.at(-1)[0]} ${p.at(-1)[1]}`);
  return out.join(' ');
}
// 이관한 이미지의 첨부 파일 이름 (media id 기준, 형식으로 확장자)
const IMAGE_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg' };
export const whiteboardImageName = (mediaId, mime) => mediaId ? `whiteboard-${String(mediaId).replace(/[^\w-]/g, '')}${IMAGE_EXT[mime] ?? ''}` : null;
export function connectorRoute(start, end, segments) {
  let [x, y] = start; const points = [start], commands = [`M ${x} ${y}`];
  const move = (angle, distance) => { const r = angle * Math.PI / 180; x += Math.cos(r) * distance; y += Math.sin(r) * distance; points.push([x, y]); };
  for (const part of String(segments ?? '').trim().split(/\s+/)) {
    const [kind, ...args] = part.split(','); const [a, b, radius] = args.map(Number);
    if (kind === 'l' && Number.isFinite(a) && Number.isFinite(b)) { move(a, b); commands.push(`L ${x} ${y}`); }
    else if (kind === 'a' && [a, b, radius].every(Number.isFinite)) {
      move(a, radius); const control = [x, y]; move(b, radius); commands.push(`Q ${control.join(' ')} ${x} ${y}`);
    }
  }
  if (points.length === 1) { points.push(end); commands.push(`L ${end.join(' ')}`); }
  return { waypoints: points, path: commands.join(' ') };
}
const parseSegments = (segments) => String(segments ?? '').trim().split(/\s+/).map((part) => {
  const [kind, ...args] = part.split(','); const [a, b, r] = args.map(Number);
  if (kind === 'l' && Number.isFinite(a) && Number.isFinite(b)) return { kind, angle: a, len: b };
  if (kind === 'a' && [a, b, r].every(Number.isFinite)) return { kind, a, b, r, dir: args[3] ?? '' };
  return null;
}).filter(Boolean);
const unit = (angle) => { const r = angle * Math.PI / 180; return [Math.round(Math.cos(r) * 1e6) / 1e6, Math.round(Math.sin(r) * 1e6) / 1e6]; };
const SIDE_ANGLE = (a) => (!a ? null : a.top === 1 ? 90 : a.top === 0 ? 270 : a.left === 0 ? 180 : a.left === 1 ? 0 : null);
// 원본의 경로 문자열(se#)은 마지막으로 그려진 배치 기준이라, 요소를 옮긴 뒤엔 끝점이 맞지 않는다(원본은 열 때 다시 계산).
// 꺾임 순서(방향)는 그대로 두고 직선 구간 길이만 새 끝점에 맞게 조정한다. 맞출 수 없으면 직각 꺾은선으로 다시 그린다.
export function fitConnectorRoute(start, end, segments, startSide = null) {
  const segs = parseSegments(segments);
  const fixed = [0, 0];
  for (const s of segs) if (s.kind === 'a') { const [ax, ay] = unit(s.a), [bx, by] = unit(s.b); fixed[0] += (ax + bx) * s.r; fixed[1] += (ay + by) * s.r; }
  const need = [end[0] - start[0] - fixed[0], end[1] - start[1] - fixed[1]];
  const lines = segs.filter((s) => s.kind === 'l');
  let ok = lines.length > 0;
  for (const axis of [0, 1]) {
    const onAxis = lines.filter((s) => Math.abs(unit(s.angle)[axis]) === 1);
    const have = onAxis.reduce((n, s) => n + s.len * unit(s.angle)[axis], 0);
    const delta = need[axis] - have;
    if (Math.abs(delta) < 0.5) continue;
    // 같은 방향으로 늘이거나, 줄여도 음수가 되지 않는 가장 긴 구간에 차이를 몰아준다
    const target = onAxis.filter((s) => s.len + delta * unit(s.angle)[axis] >= 0).sort((a, b) => b.len - a.len)[0];
    if (!target) { ok = false; break; }
    target.len += delta * unit(target.angle)[axis];
  }
  if (ok) {
    let [x, y] = start; const points = [[x, y]], commands = [`M ${x} ${y}`];
    const move = (angle, d) => { const [ux, uy] = unit(angle); x += ux * d; y += uy * d; points.push([x, y]); };
    for (const s of segs) {
      if (s.kind === 'l') { move(s.angle, s.len); commands.push(`L ${x} ${y}`); }
      else { move(s.a, s.r); const c = [x, y]; move(s.b, s.r); commands.push(`Q ${c.join(' ')} ${x} ${y}`); }
    }
    return { waypoints: points, path: commands.join(' ') };
  }
  // 직각 꺾은선: 위아래로 나가면 세로 → 가로, 옆으로 나가면 가로 → 세로 → 가로(가운데에서 꺾음)
  const [sx, sy] = start, [ex, ey] = end;
  const vertical = startSide === 90 || startSide === 270;
  const pts = vertical ? [start, [sx, ey], end] : [start, [(sx + ex) / 2, sy], [(sx + ex) / 2, ey], end];
  return { waypoints: pts, path: roundedPath(pts) };
}
// 아이콘 도형(사람·서버·코드 등): 경계 높이가 거의 0이고 아래에 이름표가 붙는다
const ICON_SHAPES = { 34: 'server', 37: 'person', 43: 'code' };
export function normalizeWhiteboard(source) {
  const j = source instanceof Uint8Array ? decodeCanvas(source) : source;
  const board = j.board ?? {}, dims = new Map((j.dimensions ?? []).map(e => [e.key, e.val])), paths = new Map((j.paths ?? []).map(e => [e.key, e.val]));
  const order = [...new Set([...(j.zindex ?? []), ...Object.keys(board)])].filter(id => board[id]);
  const elements = [], connectors = [], rawConnectors = [];
  for (const id of order) {
    const e = board[id];
    if (e.t === 'connector' || e.t === 'path') {
      const start = pair(paths.get('s#' + id)), end = pair(paths.get('e#' + id)); if (!start || !end) continue;
      const c = { id, type: e.t, from: e.se, to: e.te, start, end, ...connectorRoute(start, end, paths.get('se#' + id)), color: canvasColor(e.c, '#42526e'), startArrow: e.sc === 2, endArrow: e.ec === 2, dashed: e.sts === 2 };
      connectors.push(c); rawConnectors.push([c, e, paths.get('se#' + id)]); continue;
    }
    if (e.t === 'comment' && e.r) continue; // 해결된 댓글 표시는 원본도 기본으로 숨긴다
    // 위치(p#·bp#)는 요소의 **중심**이다 (원본 화면과 대조해 확인). bp/bs는 계산된 경계, p/s는 기본 크기일 수 있다.
    let p = pair(dims.get('bp#' + id)) ?? pair(dims.get('p#' + id)) ?? [0, 0];
    let s = pair(dims.get('bs#' + id)) ?? pair(dims.get('s#' + id)) ?? [40, 40];
    // 텍스트 상자: s#는 글자 배율(fs#) 적용 전 크기다 — 실제 크기는 s# × fs#. bs#(경계)는 더 작아 큰 글자가 잘린다
    if (e.t === 'text' && pair(dims.get('s#' + id))) { const fs = Number(dims.get('fs#' + id)) || 1; s = pair(dims.get('s#' + id)).map((v) => v * fs); }
    let icon = null;
    const rawS = pair(dims.get('s#' + id)), rawP = pair(dims.get('p#' + id)), bp = pair(dims.get('bp#' + id));
    if (e.t === 'shape' && (ICON_SHAPES[e.sh] || (s[1] <= 2 && rawS && rawS[1] > 2))) {
      // 아이콘: bp#.y가 위 끝, p#가 중심 — 높이는 그 두 배, 너비는 기본 비율대로
      icon = ICON_SHAPES[e.sh] ?? 'generic';
      const center = rawP ?? p, h = bp && center[1] > bp[1] ? 2 * (center[1] - bp[1]) : (rawS?.[1] ?? 80);
      // 너비는 bs#의 너비 (원본 커넥터가 붙는 좌우 끝이 여기에 맞는다)
      const bw = pair(dims.get('bs#' + id))?.[0];
      s = [bw > 2 ? bw : rawS ? rawS[0] * h / rawS[1] : h * 0.78, h]; p = center;
    }
    p = [p[0] - s[0] / 2, p[1] - s[1] / 2];
    const points = (e.pt ?? []).map(pair).filter(Boolean);
    if (points.length) { const xs = points.map(p => p[0]), ys = points.map(p => p[1]); p = [Math.min(...xs), Math.min(...ys)]; s = [Math.max(...xs) - p[0], Math.max(...ys) - p[1]]; }
    elements.push({ id, type: e.t, icon, x: p[0], y: p[1], w: Math.max(1, s[0]), h: Math.max(1, s[1]), rotation: Number(dims.get('r#' + id)) || 0,
      color: canvasColor(e.c, e.t === 'sticky' ? '#fff0b3' : '#ffffff'), strokeColor: canvasColor(e.stc), text: canvasText(e.tx), rich: canvasRich(e.tx), sectionTitle: canvasText(e.ti), shape: e.sh, points, pathId: e.pi, textColor: e.t === 'text' || e.t === 'pathLabel' ? canvasColor(e.c, '#172b4d') : '#172b4d', align: e.a, verticalAlign: e.va,
      fontScale: Number(dims.get('fs#' + id)) || 1, filename: e.fn ?? e.name ?? '이미지', stamp: e.si, mediaId: e.fi, mimeType: e.mt || null, imageName: e.t === 'image' ? whiteboardImageName(e.fi, e.mt) : undefined, commentId: e.ci, attachment: e.at ?? null });
  }
  // Attached stamps/comments use parent bounds plus offset; ordinary section children already use world coordinates.
  const byId = new Map(elements.map(e => [e.id, e]));
  for (const e of elements) if (e.attachment) { const parent = byId.get(e.attachment.parentId), offset = pair(e.attachment.offset); if (parent && offset) { e.x = parent.x + offset[0]; e.y = parent.y + offset[1]; } }
  // 요소에 붙은 커넥터는 붙은 지점(sa/ta: 요소 안 비율 위치)에서 다시 잇는다
  const anchor = (el, a) => a && Number.isFinite(a.left) && Number.isFinite(a.top) ? [el.x + el.w * a.left, el.y + el.h * a.top] : null;
  // 경유점(pathWaypoint): 사용자가 끌어 놓은 꺾임 위치. ax 0 = 세로 구간이 지나는 x, ax 1 = 가로 구간이 지나는 y (p#에 좌표)
  const waypoints = new Map();
  for (const [wid, w] of Object.entries(board)) if (w?.t === 'pathWaypoint' && w.pi) { const at = pair(dims.get('p#' + wid)); if (at) waypoints.set(w.pi, { axis: w.ax === 1 ? 1 : 0, at }); }
  for (const [c, e, segments] of rawConnectors) {
    const from = byId.get(e.se), to = byId.get(e.te);
    const start = from && anchor(from, e.sa), end = to && anchor(to, e.ta);
    const wp = waypoints.get(c.id);
    if (!start && !end && !wp) continue;
    c.start = start ?? c.start; c.end = end ?? c.end;
    if (wp) {
      const [sx, sy] = c.start, [ex, ey] = c.end;
      const pts = wp.axis === 0 ? [c.start, [wp.at[0], sy], [wp.at[0], ey], c.end] : [c.start, [sx, wp.at[1]], [ex, wp.at[1]], c.end];
      Object.assign(c, { waypoints: pts, path: roundedPath(pts) });
    } else Object.assign(c, fitConnectorRoute(c.start, c.end, segments, SIDE_ANGLE(e.sa)));
  }
  for (const e of elements) if (e.type === 'pathLabel' && (e.w <= 1 || !dims.has('s#' + e.id))) { const path = connectors.find(c => c.id === e.pathId); if (path) { e.w = Math.max(80, e.text.length * 7); e.h = 40; e.x = (path.start[0] + path.end[0]) / 2 - e.w / 2; e.y = (path.start[1] + path.end[1]) / 2 - 20; } }
  return { elements, connectors, order, plainText: elements.map(e => [e.text, e.sectionTitle, e.type === 'image' ? e.filename : ''].filter(Boolean).join(' ')).filter(Boolean).join('\n') };
}
export async function fetchWhiteboard(id, { get, site, fetchImpl = fetch, extras = true }) {
  const content = await get(`/wiki/rest/api/content/${encodeURIComponent(id)}?expand=version,ancestors,space`);
  const { cloudId } = await get('/_edge/tenant_info');
  const [session] = await get(`/wiki/rest/internal/1.0/canvas/session/bulk?ids=${encodeURIComponent(id)}`);
  const res = await fetchImpl(`${site}/gateway/api/canvas-tenant-context/site/${cloudId}/api/_internal/collab/${encodeURIComponent(content.referenceId)}?skipSteps=true&v=2`, { headers: { 'x-access-token': session.data.access.token } });
  if (!res.ok) throw new Error(`whiteboard ${id}: collab ${res.status}`);
  const binary = Buffer.from(await res.arrayBuffer());
  const data = normalizeWhiteboard(binary);
  const more = extras ? await fetchWhiteboardExtras(id, data, { get, fetchImpl, media: session.data.media }) : { images: [], comments: [], losses: [] };
  return { content, binary, data, ...more };
}

// 이미지 원본과 댓글 — 모두 GET. 실패해도 보드 이관은 계속하고 손실(losses)로 남긴다.
//  - 이미지: canvas 세션의 media 토큰(JWT, iss = 클라이언트 id)으로 api.media.atlassian.com/file/<media id>/binary?collection=contentId-<id>
//  - 댓글: 보드의 인라인 댓글(content/<id>/child/comment) — extensions.inlineProperties.markerRef = 보드 댓글 요소의 ci
export async function fetchWhiteboardExtras(id, data, { get, fetchImpl = fetch, media }) {
  const images = [], comments = [], losses = [];
  const wanted = new Map();
  for (const e of data.elements ?? []) if (e.type === 'image' && e.mediaId && e.imageName) wanted.set(e.mediaId, e);
  if (wanted.size && !media?.token) losses.push(`이미지 ${wanted.size}개: media 토큰 없음`);
  else if (wanted.size) {
    let clientId = null;
    try { clientId = JSON.parse(Buffer.from(media.token.split('.')[1], 'base64url').toString()).iss; } catch { /* 토큰 형식이 다르면 아래에서 실패로 기록 */ }
    const base = (media.baseUrl || 'https://api.media.atlassian.com').replace(/\/$/, '');
    const collection = `contentId-${media.contentId ?? id}`;
    for (const [mediaId, e] of wanted) {
      try {
        const r = await fetchImpl(`${base}/file/${encodeURIComponent(mediaId)}/binary?collection=${encodeURIComponent(collection)}`, { headers: { Authorization: `Bearer ${media.token}`, ...(clientId ? { 'X-Client-Id': clientId } : {}) } });
        if (!r.ok) { losses.push(`이미지 ${mediaId}: ${r.status}`); continue; }
        const buffer = Buffer.from(await r.arrayBuffer());
        images.push({ mediaId, filename: e.imageName, mimeType: (r.headers.get('content-type') || e.mimeType || '').split(';')[0] || null, buffer });
      } catch (err) { losses.push(`이미지 ${mediaId}: ${err.message}`); }
    }
  }
  if ((data.elements ?? []).some((e) => e.type === 'comment')) {
    try {
      let next = `/wiki/rest/api/content/${encodeURIComponent(id)}/child/comment?expand=body.storage,history,version,extensions.inlineProperties,extensions.resolution&depth=all&limit=100`;
      while (next) {
        const page = await get(next);
        for (const c of page?.results ?? []) {
          const ref = c.extensions?.inlineProperties?.markerRef;
          comments.push({ id: c.id, markerRef: ref ?? null, resolved: c.extensions?.resolution?.status === 'resolved',
            xhtml: c.body?.storage?.value ?? '', authorId: c.history?.createdBy?.accountId ?? c.version?.by?.accountId ?? null,
            createdAt: c.history?.createdDate ?? c.version?.when ?? null, parentId: c.ancestors?.at?.(-1)?.id ?? null });
        }
        const n = page?._links?.next; next = n ? (n.startsWith('/wiki') ? n : '/wiki' + n) : null;
      }
    } catch (err) { losses.push(`댓글: ${err.message}`); }
  }
  return { images, comments, losses };
}
