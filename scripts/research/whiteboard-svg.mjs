// 화이트보드 Yjs 스냅샷(.ybin) → 정적 SVG 시제품 (GIRA-58 구현 가능성 확인용, 2026-11-06)
// 사용: node scripts/research/whiteboard-svg.mjs <whiteboard-ID.ybin> <out.svg>
// 한계: 커넥터는 직선(paths se# 꺾임 무시), 섹션 안 요소 좌표 기준 미확인, 이미지는 회색 자리, 스탬프는 원, 리치 텍스트 서식 무시.
import * as Y from 'yjs';
import { readFileSync, writeFileSync } from 'node:fs';
const [,, inFile, outFile] = process.argv;
const doc = new Y.Doc(); Y.applyUpdate(doc, readFileSync(inFile));
const board = doc.getMap('board').toJSON();
const kv = (k) => { const m = new Map(); if (doc.share.get(k)) for (const e of doc.getArray(k).toJSON()) m.set(e.key, e.val); return m; };
const dims = kv('dimensions'); const paths = kv('paths');
const order = doc.share.get('zindex') ? doc.getArray('zindex').toJSON() : Object.keys(board);
const v2 = (v) => (v ? [v[0] ?? v['0'], v[1] ?? v['1']] : null);
const buf = (o) => (o && typeof o === 'object' && '0' in o ? Buffer.from(Object.values(o)) : null);
const color = (o, fallback) => { const b = buf(o); if (!b || b.length < 12) return fallback; const c = [0, 4, 8].map((i) => Math.round(b.readFloatBE(i))); return `rgb(${c.join(',')})`; };
const text = (o) => { const b = buf(o); if (!b) return ''; return b.toString('utf8').replace(/[\x00-\x08\x0b-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[^\p{L}\p{N}(\[]+/u, ''); };
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
const grow = (x, y, w = 0, h = 0) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h); };
const parts = [];
const box = (id) => { const p = v2(dims.get('p#' + id)); const s = v2(dims.get('s#' + id)) ?? v2(dims.get('bs#' + id)); return p && s ? { x: p[0], y: p[1], w: s[0], h: s[1] } : null; };
const label = (b, t, size = 14) => t ? `<foreignObject x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"><div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;align-items:center;justify-content:center;text-align:center;width:100%;height:100%;font:${size}px sans-serif;overflow:hidden;padding:4px;box-sizing:border-box">${esc(t)}</div></foreignObject>` : '';
const unknown = {};
for (const id of order) {
  const el = board[id]; if (!el) continue;
  const b = box(id);
  switch (el.t) {
    case 'section': if (!b) break; grow(b.x, b.y, b.w, b.h);
      parts.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${color(el.c, '#f4f5f7')}" fill-opacity=".35" stroke="#c1c7d0"/><text x="${b.x + 8}" y="${b.y - 8}" font-size="16" font-family="sans-serif">${esc(text(el.ti) || String(el.ti ?? ''))}</text>`); break;
    case 'shape': if (!b) break; grow(b.x, b.y, b.w, b.h);
      parts.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${el.sh === 3 ? 8 : 0}" fill="${color(el.c, '#deebff')}" stroke="${color(el.stc, 'none')}"/>${label(b, text(el.tx))}`); break;
    case 'sticky': if (!b) break; grow(b.x, b.y, b.w, b.h);
      parts.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${color(el.c, '#fff0b3')}" filter="drop-shadow(0 1px 2px #0003)"/>${label(b, text(el.tx), 16)}`); break;
    case 'text': if (!b) break; grow(b.x, b.y, b.w, b.h);
      parts.push(label(b, text(el.tx), 14 * (dims.get('fs#' + id) ?? 1))); break;
    case 'image': if (!b) break; grow(b.x, b.y, b.w, b.h);
      parts.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="#ebecf0"/><text x="${b.x + b.w / 2}" y="${b.y + b.h / 2}" text-anchor="middle" font-size="14">이미지</text>`); break;
    case 'stamp': if (!b) { const p = v2(dims.get('p#' + id)); if (!p) break; grow(p[0], p[1], 40, 40); parts.push(`<circle cx="${p[0] + 20}" cy="${p[1] + 20}" r="18" fill="#ffab00"/>`); break; }
      grow(b.x, b.y, b.w, b.h); parts.push(`<circle cx="${b.x + b.w / 2}" cy="${b.y + b.h / 2}" r="${Math.min(b.w, b.h) / 2}" fill="#ffab00"/>`); break;
    case 'connector': case 'path': {
      const s = v2(paths.get('s#' + id)), e = v2(paths.get('e#' + id)); if (!s || !e) break;
      grow(s[0], s[1]); grow(e[0], e[1]);
      parts.push(`<line x1="${s[0]}" y1="${s[1]}" x2="${e[0]}" y2="${e[1]}" stroke="${color(el.c, '#42526e')}" stroke-width="2" marker-end="url(#arr)"/>`); break;
    }
    default: unknown[el.t] = (unknown[el.t] ?? 0) + 1;
  }
}
const pad = 40;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}" style="background:#fff">
<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#42526e"/></marker></defs>
${parts.join('\n')}</svg>`;
writeFileSync(outFile, svg);
console.log('elements', Object.keys(board).length, 'drawn', parts.length, 'skipped', unknown, 'bbox', Math.round(maxX - minX), Math.round(maxY - minY));
