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
// Rich text contains length-prefixed UTF-8 runs (tag 4); do not display its binary formatting tags.
export function canvasText(v) {
  if (typeof v === 'string') return v;
  const b = bytes(v); if (!b) return '';
  const runs = [];
  for (let i = 0; i < b.length; i++) {
    if (b[i] !== 4) continue;
    let length = 0, shift = 0, p = i + 1;
    while (p < b.length && shift < 35) { const n = b[p++]; length += (n & 127) * 2 ** shift; shift += 7; if (!(n & 128)) break; }
    if (!length || p + length > b.length) continue;
    try { const s = new TextDecoder('utf-8', { fatal: true }).decode(b.slice(p, p + length));
      if (!/[\x00-\x08\x0b-\x1f]/.test(s)) { runs.push(s); i = p + length - 1; }
    } catch { /* not a text run */ }
  }
  return runs.join('');
}
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
export function normalizeWhiteboard(source) {
  const j = source instanceof Uint8Array ? decodeCanvas(source) : source;
  const board = j.board ?? {}, dims = new Map((j.dimensions ?? []).map(e => [e.key, e.val])), paths = new Map((j.paths ?? []).map(e => [e.key, e.val]));
  const order = [...new Set([...(j.zindex ?? []), ...Object.keys(board)])].filter(id => board[id]);
  const elements = [], connectors = [];
  for (const id of order) {
    const e = board[id];
    if (e.t === 'connector' || e.t === 'path') {
      const start = pair(paths.get('s#' + id)), end = pair(paths.get('e#' + id)); if (!start || !end) continue;
      connectors.push({ id, type: e.t, from: e.se, to: e.te, start, end, ...connectorRoute(start, end, paths.get('se#' + id)), color: canvasColor(e.c, '#42526e'), startArrow: e.sc === 2, endArrow: e.ec === 2 }); continue;
    }
    // bp/bs are the computed world bounds, p/s may still hold the original default size.
    let p = pair(dims.get('bp#' + id)) ?? pair(dims.get('p#' + id)) ?? [0, 0];
    let s = pair(dims.get('bs#' + id)) ?? pair(dims.get('s#' + id)) ?? [40, 40];
    const points = (e.pt ?? []).map(pair).filter(Boolean);
    if (points.length) { const xs = points.map(p => p[0]), ys = points.map(p => p[1]); p = [Math.min(...xs), Math.min(...ys)]; s = [Math.max(...xs) - p[0], Math.max(...ys) - p[1]]; }
    elements.push({ id, type: e.t, x: p[0], y: p[1], w: Math.max(1, s[0]), h: Math.max(1, s[1]), rotation: Number(dims.get('r#' + id)) || 0,
      color: canvasColor(e.c, e.t === 'sticky' ? '#fff0b3' : '#ffffff'), strokeColor: canvasColor(e.stc), text: canvasText(e.tx), sectionTitle: canvasText(e.ti), shape: e.sh, points, pathId: e.pi, textColor: e.t === 'text' || e.t === 'pathLabel' ? canvasColor(e.c, '#172b4d') : '#172b4d', align: e.a, verticalAlign: e.va,
      fontScale: Number(dims.get('fs#' + id)) || 1, filename: e.fn ?? e.name ?? '이미지 (이관 대기)', stamp: e.si, mediaId: e.fi, commentId: e.ci, attachment: e.at ?? null });
  }
  // Attached stamps/comments use parent bounds plus offset; ordinary section children already use world coordinates.
  const byId = new Map(elements.map(e => [e.id, e]));
  for (const e of elements) if (e.attachment) { const parent = byId.get(e.attachment.parentId), offset = pair(e.attachment.offset); if (parent && offset) { e.x = parent.x + offset[0]; e.y = parent.y + offset[1]; } }
  for (const e of elements) if (e.type === 'pathLabel' && (e.w <= 1 || !dims.has('s#' + e.id))) { const path = connectors.find(c => c.id === e.pathId); if (path) { e.w = Math.max(80, e.text.length * 7); e.h = 40; e.x = (path.start[0] + path.end[0]) / 2 - e.w / 2; e.y = (path.start[1] + path.end[1]) / 2 - 20; } }
  return { elements, connectors, order, plainText: elements.map(e => [e.text, e.sectionTitle, e.type === 'image' ? e.filename : ''].filter(Boolean).join(' ')).filter(Boolean).join('\n') };
}
export async function fetchWhiteboard(id, { get, site, fetchImpl = fetch }) {
  const content = await get(`/wiki/rest/api/content/${encodeURIComponent(id)}?expand=version,ancestors,space`);
  const { cloudId } = await get('/_edge/tenant_info');
  const [session] = await get(`/wiki/rest/internal/1.0/canvas/session/bulk?ids=${encodeURIComponent(id)}`);
  const res = await fetchImpl(`${site}/gateway/api/canvas-tenant-context/site/${cloudId}/api/_internal/collab/${encodeURIComponent(content.referenceId)}?skipSteps=true&v=2`, { headers: { 'x-access-token': session.data.access.token } });
  if (!res.ok) throw new Error(`whiteboard ${id}: collab ${res.status}`);
  const binary = Buffer.from(await res.arrayBuffer());
  return { content, binary, data: normalizeWhiteboard(binary) };
}
