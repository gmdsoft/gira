// 이관된 화이트보드(정규화 데이터: scripts/lib/confluence-whiteboard.mjs) → Excalidraw 장면 (GIRA-74)
// 편집기를 처음 열 때 한 번 변환하고, 저장하면 이후로는 Excalidraw 장면 그대로 쌓인다.
import { iconGlyph } from './whiteboard-svg.mjs';

const hex = (c, fallback) => {
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(c ?? '');
  if (m) return '#' + m.slice(1).map((v) => Number(v).toString(16).padStart(2, '0')).join('');
  return typeof c === 'string' && c.startsWith('#') ? c : fallback;
};
const FONT = 2; // Helvetica 계열(시스템 글꼴) — 한글은 브라우저 기본 글꼴로
const STAMP = { fire: '🔥', success: '✅', heart: '❤️', like: '👍', question: '❓', star: '⭐' };

export function toExcalidrawScene(data) {
  let seed = 1;
  const out = [], files = {}, byId = new Map();
  const base = (id, x, y, w, h, extra) => {
    const el = { id, x, y, width: Math.max(1, w), height: Math.max(1, h), angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent',
      fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'solid', roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: null,
      seed: seed++, version: 1, versionNonce: seed, isDeleted: false, boundElements: [], updated: 1, link: null, locked: false, ...extra };
    byId.set(id, el); return el;
  };
  // 글자 상자: 줄 수 × 글자 크기로 높이를 잡고, 상자 안 글자는 세로 가운데에 둔다 (편집기가 열 때 줄바꿈·크기를 다시 계산)
  const text = (id, x, y, w, h, value, size, { containerId = null, align = 'center', color = '#172b4d', valign } = {}) => {
    const th = String(value).split('\n').length * size * 1.25;
    const middle = (valign ?? (containerId ? 'middle' : 'top')) === 'middle';
    const pad = containerId ? 5 : 0;
    return base(id, x + pad, middle ? y + (h - th) / 2 : y, w - pad * 2, th, {
      type: 'text', text: value, originalText: value, fontSize: size, fontFamily: FONT, textAlign: align, verticalAlign: middle ? 'middle' : 'top',
      containerId, lineHeight: 1.25, strokeColor: color, autoResize: !containerId });
  };
  const elements = data?.elements ?? [];
  for (const e of elements) {
    const angle = (Number(e.rotation) || 0) * Math.PI / 180;
    if (e.type === 'section') {
      // 섹션 → 프레임(함께 움직임) + 그 안의 색 배경 사각형
      out.push(base(e.id, e.x, e.y, e.w, e.h, { type: 'frame', name: String(e.sectionTitle ?? '').trim() || '섹션' }));
      out.push(base(e.id + '-bg', e.x, e.y, e.w, e.h, { type: 'rectangle', backgroundColor: hex(e.color, '#e9f2ff'), strokeColor: 'transparent', frameId: e.id }));
    } else if (e.icon) {
      // 아이콘 → SVG 이미지 + 아래 이름표
      const gh = e.h * 0.62;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${e.x} ${e.y} ${e.w} ${gh}" width="${e.w}" height="${gh}">${iconGlyph(e)}</svg>`;
      const fileId = 'icon-' + e.id;
      files[fileId] = { id: fileId, mimeType: 'image/svg+xml', dataURL: 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg))), created: 1 };
      out.push(base(e.id, e.x, e.y, e.w, gh, { type: 'image', fileId, status: 'saved', scale: [1, 1], angle }));
      if (e.text) out.push(text(e.id + '-t', e.x, e.y + gh, e.w, e.h - gh, e.text, 14 * (e.fontScale || 1), { valign: 'middle' }));
    } else if (e.type === 'shape' || e.type === 'sticky') {
      const kind = e.shape === 2 ? 'ellipse' : e.shape === 4 ? 'diamond' : 'rectangle';
      const el = base(e.id, e.x, e.y, e.w, e.h, { type: kind, angle, backgroundColor: hex(e.color, e.type === 'sticky' ? '#fff0b3' : '#ffffff'),
        strokeColor: e.type === 'sticky' ? 'transparent' : hex(e.strokeColor, 'transparent'), roundness: kind === 'rectangle' ? { type: 3 } : null });
      out.push(el);
      if (e.text) { const t = text(e.id + '-t', e.x, e.y, e.w, e.h, e.text, 14 * (e.fontScale || 1), { containerId: e.id }); t.angle = angle; el.boundElements.push({ type: 'text', id: t.id }); out.push(t); }
    } else if (e.type === 'text' || e.type === 'pathLabel') {
      out.push(text(e.id, e.x, e.y, e.w, e.h, e.text ?? '', 14 * (e.fontScale || 1), { align: e.type === 'text' ? 'left' : 'center', color: hex(e.textColor, '#172b4d') }));
    } else if (e.type === 'image') {
      out.push(base(e.id, e.x, e.y, e.w, e.h, { type: 'rectangle', backgroundColor: '#ebecf0', strokeColor: '#c1c7d0' }));
      out.push(text(e.id + '-t', e.x, e.y, e.w, e.h, e.filename || '이미지 (이관 대기)', 14, { containerId: e.id }));
      byId.get(e.id).boundElements.push({ type: 'text', id: e.id + '-t' });
    } else if (e.type === 'stamp') {
      out.push(text(e.id, e.x, e.y, e.w, e.h, STAMP[e.stamp] ?? '●', Math.max(12, Math.min(e.w, e.h) * 0.8)));
    } else if (e.type === 'drawing' && e.points?.length) {
      const [x0, y0] = e.points[0];
      out.push(base(e.id, e.x, e.y, e.w, e.h, { type: 'freedraw', points: e.points.map(([x, y]) => [x - x0, y - y0]), pressures: [], simulatePressure: true, strokeColor: hex(e.color, '#1e1e1e'), strokeWidth: 2, x: x0, y: y0 }));
    }
  }
  for (const c of data?.connectors ?? []) {
    const pts = (c.waypoints?.length >= 2 ? c.waypoints : [c.start, c.end]).filter((p) => p?.every(Number.isFinite));
    if (pts.length < 2) continue;
    const [x0, y0] = pts[0];
    const rel = pts.map(([x, y]) => [x - x0, y - y0]);
    const xs = rel.map((p) => p[0]), ys = rel.map((p) => p[1]);
    const arrow = base(c.id, x0, y0, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), {
      type: 'arrow', points: rel, strokeColor: hex(c.color, '#42526e'), strokeWidth: 1, strokeStyle: c.dashed ? 'dashed' : 'solid',
      startArrowhead: c.startArrow ? 'arrow' : null, endArrowhead: c.endArrow ? 'arrow' : null, elbowed: false, lastCommittedPoint: null,
      startBinding: null, endBinding: null });
    // 요소에 붙은 끝은 묶어 둔다 — 요소를 옮기면 화살표 끝이 따라온다
    for (const [end, target] of [['startBinding', c.from], ['endBinding', c.to]]) {
      const el = target && byId.get(target);
      if (el && el.type !== 'frame') { arrow[end] = { elementId: target, focus: 0, gap: 1 }; el.boundElements.push({ type: 'arrow', id: c.id }); }
    }
    out.push(arrow);
  }
  // 섹션 안에 완전히 들어가는 요소는 그 프레임 소속으로 (함께 이동)
  const frames = out.filter((o) => o.type === 'frame');
  for (const o of out) {
    if (o.type === 'frame' || o.frameId || o.containerId) continue;
    const f = frames.find((f) => o.x >= f.x && o.y >= f.y && o.x + o.width <= f.x + f.width && o.y + o.height <= f.y + f.height);
    if (f) o.frameId = f.id;
  }
  for (const o of out) if (o.containerId) o.frameId = byId.get(o.containerId)?.frameId ?? null;
  // 프레임은 맨 앞(맨 아래)에, 프레임 배경은 그 바로 다음
  const rank = (o) => (o.type === 'frame' ? 0 : o.id.endsWith('-bg') ? 1 : 2);
  out.sort((a, b) => rank(a) - rank(b));
  return { format: 'excalidraw', elements: out, files, appState: { viewBackgroundColor: '#ffffff' } };
}

// 저장용 장면 — 지운 요소는 빼고, 쓰는 이미지만 남긴다
export function sceneForSave(elements, files, appState) {
  const live = elements.filter((e) => !e.isDeleted);
  const used = new Set(live.map((e) => e.fileId).filter(Boolean));
  return {
    format: 'excalidraw',
    elements: live,
    files: Object.fromEntries(Object.entries(files ?? {}).filter(([id]) => used.has(id)).map(([id, f]) => [id, { id, mimeType: f.mimeType, dataURL: f.dataURL, created: f.created }])),
    appState: { viewBackgroundColor: appState?.viewBackgroundColor ?? '#ffffff' },
  };
}
