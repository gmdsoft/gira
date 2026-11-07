const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const n = value => Number.isFinite(Number(value)) ? Number(value) : 0;
export function whiteboardBounds(data) {
  const points = (data.elements ?? []).flatMap(e => {
    const angle = n(e.rotation) * Math.PI / 180, cx = e.x + e.w / 2, cy = e.y + e.h / 2;
    return [[e.x, e.y - (e.sectionTitle ? 30 : 0)], [e.x + e.w, e.y], [e.x, e.y + e.h], [e.x + e.w, e.y + e.h]].map(([x, y]) => [cx + (x - cx) * Math.cos(angle) - (y - cy) * Math.sin(angle), cy + (x - cx) * Math.sin(angle) + (y - cy) * Math.cos(angle)]);
  }).concat((data.connectors ?? []).flatMap(c => c.waypoints ?? [c.start, c.end])).filter(p => p?.every(Number.isFinite));
  if (!points.length) return [0, 0, 1000, 600];
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  return [Math.min(...xs) - 40, Math.min(...ys) - 40, Math.max(...xs) - Math.min(...xs) + 80, Math.max(...ys) - Math.min(...ys) + 80];
}
export function whiteboardSvg(data) {
  const bounds = whiteboardBounds(data), elements = new Map((data.elements ?? []).map(e => [e.id, e])), connectors = new Map((data.connectors ?? []).map(e => [e.id, e]));
  // 텍스트 요소는 원본처럼 왼쪽 위 정렬·줄바꿈 없이 내용 크기만큼 (상자 밖으로 넘쳐도 보이게)
  const label = (e, text = e.text) => text ? `<foreignObject x="${n(e.x)}" y="${n(e.y)}" width="${n(e.w)}" height="${n(e.h)}"${e.type === 'text' ? ' style="overflow:visible"' : ''}><div xmlns="http://www.w3.org/1999/xhtml" style="${e.type === 'text' ? 'display:block;text-align:left;white-space:pre;' : 'display:flex;align-items:center;justify-content:center;text-align:center;white-space:pre-wrap;'}overflow-wrap:anywhere;width:100%;height:100%;padding:4px;box-sizing:border-box;font:${14 * (e.fontScale || 1)}px sans-serif;color:${esc(e.textColor ?? "#172b4d")}">${esc(text)}</div></foreignObject>` : '';
  const parts = [];
  for (const id of data.order ?? [...elements.keys(), ...connectors.keys()]) {
    const c = connectors.get(id);
    if (c) { parts.push(`<path d="${esc(c.path)}" fill="none" stroke="${esc(c.color)}" stroke-width="2"${c.startArrow ? ' marker-start="url(#wb-arrow-start)"' : ''}${c.endArrow ? ' marker-end="url(#wb-arrow)"' : ''}/>`); continue; }
    const e = elements.get(id); if (!e) continue;
    const { x, y, w, h } = e; let body = '';
    const rect = (fill, stroke = e.strokeColor, opacity = 1) => `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${e.shape === 3 ? 8 : 0}" fill="${esc(fill)}" fill-opacity="${opacity}" stroke="${esc(stroke)}"/>`;
    if (e.type === 'section') body = rect(e.color, '#c1c7d0', .35) + `<text x="${n(x)}" y="${n(y - 8)}" font-size="16" font-family="sans-serif">${esc(e.sectionTitle)}</text>`;
    else if (e.type === 'text' || e.type === 'pathLabel') body = label(e);
    else if (e.type === 'image') body = rect('#ebecf0', '#c1c7d0') + label(e, e.filename);
    else if (e.type === 'stamp') body = `<text x="${n(x + w / 2)}" y="${n(y + h / 2)}" dominant-baseline="central" text-anchor="middle" font-size="${Math.min(w, h)}">${esc(({ fire: '🔥', success: '✅', heart: '❤️', like: '👍', question: '❓', star: '⭐' })[e.stamp] ?? '●')}</text>`;
    else if (e.type === 'comment') body = `<circle cx="${n(x + 12)}" cy="${n(y + 12)}" r="12" fill="#deebff"/><text x="${n(x + 12)}" y="${n(y + 17)}" text-anchor="middle" font-size="14">💬</text>`;
    else if (e.type === 'drawing') body = `<polyline points="${(e.points ?? []).map(p => p.map(n).join(',')).join(' ')}" fill="none" stroke="${esc(e.color)}" stroke-width="2"/>`;
    else if (e.type === 'shape' || e.type === 'sticky') {
      if (e.shape === 2) body = `<ellipse cx="${n(x + w / 2)}" cy="${n(y + h / 2)}" rx="${n(w / 2)}" ry="${n(h / 2)}" fill="${esc(e.color)}" stroke="${esc(e.strokeColor)}"/>`;
      else if (e.shape === 4) body = `<polygon points="${n(x + w / 2)},${n(y)} ${n(x + w)},${n(y + h / 2)} ${n(x + w / 2)},${n(y + h)} ${n(x)},${n(y + h / 2)}" fill="${esc(e.color)}" stroke="${esc(e.strokeColor)}"/>`;
      else body = rect(e.color);
      body += label(e);
    }
    parts.push(`<g transform="rotate(${n(e.rotation)} ${n(x + w / 2)} ${n(y + h / 2)})">${body}</g>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.join(' ')}" width="100%" height="100%" role="img" aria-label="화이트보드"><defs><marker id="wb-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10Z" fill="context-stroke"/></marker><marker id="wb-arrow-start" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M10 0 L0 5 L10 10Z" fill="context-stroke"/></marker></defs>${parts.join('')}</svg>`;
}
