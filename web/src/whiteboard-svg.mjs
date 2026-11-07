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
// 아이콘 도형(사람·서버·코드): 상자 위쪽 60%에 그림, 아래는 이름표
export function iconGlyph(e) {
  const gh = e.h * 0.58, gw = Math.min(e.w, gh * 0.8), cx = e.x + e.w / 2, top = e.y, left = cx - gw / 2;
  const fill = esc(e.color), stroke = esc(e.strokeColor === 'none' ? '#42526e' : e.strokeColor), sw = Math.max(1.5, gh / 30);
  if (e.icon === 'person') {
    const r = gh * 0.2;
    return `<circle cx="${n(cx)}" cy="${n(top + r + sw)}" r="${n(r)}" fill="${fill}" stroke="${stroke}" stroke-width="${n(sw)}"/>`
      + `<path d="M ${n(left)} ${n(top + gh)} L ${n(left)} ${n(top + gh * 0.68)} Q ${n(left)} ${n(top + gh * 0.48)} ${n(cx)} ${n(top + gh * 0.48)} Q ${n(left + gw)} ${n(top + gh * 0.48)} ${n(left + gw)} ${n(top + gh * 0.68)} L ${n(left + gw)} ${n(top + gh)} Z" fill="${fill}" stroke="${stroke}" stroke-width="${n(sw)}"/>`;
  }
  if (e.icon === 'server') {
    const bh = gh / 3.4;
    return [0, 1, 2].map((i) => `<rect x="${n(left)}" y="${n(top + i * bh * 1.2)}" width="${n(gw)}" height="${n(bh)}" rx="${n(bh / 5)}" fill="${fill}" stroke="${stroke}" stroke-width="${n(sw)}"/><line x1="${n(left + gw * 0.15)}" y1="${n(top + i * bh * 1.2 + bh / 2)}" x2="${n(left + gw * 0.55)}" y2="${n(top + i * bh * 1.2 + bh / 2)}" stroke="${stroke}" stroke-width="${n(sw)}"/>`).join('');
  }
  const box = `<rect x="${n(left)}" y="${n(top)}" width="${n(gw)}" height="${n(gh)}" rx="${n(gh / 6)}" fill="${fill}" stroke="${stroke}" stroke-width="${n(sw)}"/>`;
  if (e.icon === 'code') {
    const m = gh / 2, a = gw * 0.18;
    return box + `<path d="M ${n(cx - a * 0.4)} ${n(top + m - a)} L ${n(cx - a * 1.4)} ${n(top + m)} L ${n(cx - a * 0.4)} ${n(top + m + a)} M ${n(cx + a * 0.4)} ${n(top + m - a)} L ${n(cx + a * 1.4)} ${n(top + m)} L ${n(cx + a * 0.4)} ${n(top + m + a)}" fill="none" stroke="${stroke}" stroke-width="${n(sw)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  return box;
}
// 서식 있는 글자(GIRA-78): 줄마다 div — 목록 기호·들여쓰기, 제목은 굵게, 글자 조각은 굵게·기울임·취소선·링크
const safeHref = (href) => /^https?:\/\//i.test(String(href ?? '')) ? String(href) : null;
export function richHtml(lines) {
  return lines.map((l) => {
    const runs = l.runs.map((r) => {
      let h = esc(r.text);
      if (r.b) h = `<b>${h}</b>`; if (r.i) h = `<i>${h}</i>`; if (r.s) h = `<s>${h}</s>`;
      const href = safeHref(r.href);
      return href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" style="color:#0c66e4">${h}</a>` : h;
    }).join('');
    const mark = l.list === 'ul' ? ['•', '◦', '▪'][(l.depth ?? 0) % 3] : l.list === 'ol' ? `${l.n ?? 1}.` : '';
    const style = [l.heading ? 'font-weight:600' : '', l.list ? `padding-left:${1.2 * ((l.depth ?? 0) + 1)}em;text-indent:-1.2em` : ''].filter(Boolean).join(';');
    return `<div${style ? ` style="${style}"` : ''}>${mark ? `<span style="display:inline-block;width:1.2em;text-indent:0">${esc(mark)}</span>` : ''}${runs || '<br/>'}</div>`;
  }).join('');
}
const STAMPS = { fire: '🔥', success: '✅', heart: '❤️', like: '👍', question: '❓', star: '⭐' };
// opts.contentId: 이관한 이미지 원본을 /api/att/<id>/<파일>로 표시. opts.comments: { ci → 댓글 수 } (원본 댓글 이관분)
export function whiteboardSvg(data, opts = {}) {
  const bounds = whiteboardBounds(data), elements = new Map((data.elements ?? []).map(e => [e.id, e])), connectors = new Map((data.connectors ?? []).map(e => [e.id, e]));
  // 텍스트 요소는 원본처럼 왼쪽 위 정렬·줄바꿈 없이 내용 크기만큼 (상자 밖으로 넘쳐도 보이게)
  const label = (e, text = e.text) => text ? `<foreignObject x="${n(e.x)}" y="${n(e.y)}" width="${n(e.w)}" height="${n(e.h)}"${e.type === 'text' ? ' style="overflow:visible"' : ''}><div xmlns="http://www.w3.org/1999/xhtml" style="${e.type === 'text' ? 'display:block;text-align:left;white-space:pre;' : e.rich ? 'display:flex;flex-direction:column;justify-content:center;text-align:left;white-space:pre-wrap;' : 'display:flex;align-items:center;justify-content:center;text-align:center;white-space:pre-wrap;'}overflow-wrap:anywhere;width:100%;height:100%;padding:4px;box-sizing:border-box;font:${14 * (e.fontScale || 1)}px sans-serif;color:${esc(e.textColor ?? "#172b4d")}">${e.rich && text === e.text ? richHtml(e.rich) : esc(text)}</div></foreignObject>` : '';
  const parts = [];
  for (const id of data.order ?? [...elements.keys(), ...connectors.keys()]) {
    const c = connectors.get(id);
    if (c) { parts.push(`<path d="${esc(c.path)}" fill="none" stroke="${esc(c.color)}" stroke-width="1.5"${c.dashed ? ' stroke-dasharray="6 4"' : ''}${c.startArrow ? ' marker-start="url(#wb-arrow-start)"' : ''}${c.endArrow ? ' marker-end="url(#wb-arrow)"' : ''}/>`); continue; }
    const e = elements.get(id); if (!e) continue;
    const { x, y, w, h } = e; let body = '';
    const rect = (fill, stroke = e.strokeColor, opacity = 1) => `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${e.shape === 3 ? 8 : e.type === 'section' ? 0 : 3}" fill="${esc(fill)}" fill-opacity="${opacity}" stroke="${esc(stroke)}"/>`;
    // 섹션: 원본처럼 테두리 없는 색 영역 + 왼쪽 위 바깥의 제목 꼬리표
    if (e.type === 'section') {
      const title = String(e.sectionTitle ?? '').trim(), tw = Math.max(40, [...title].length * 13 + 16);
      body = rect(e.color, 'none') + (title ? `<rect x="${n(x)}" y="${n(y - 30)}" width="${n(tw)}" height="24" rx="4" fill="#1d7afc"/><text x="${n(x + 8)}" y="${n(y - 13)}" font-size="14" font-family="sans-serif" fill="#ffffff">${esc(title)}</text>` : '');
    }
    else if (e.icon) body = iconGlyph(e) + label({ ...e, y: y + h * 0.62, h: h * 0.38 });
    else if (e.type === 'text' || e.type === 'pathLabel') body = label(e);
    // 이미지: 자리 표시 상자 위에 이관한 원본 — 원본이 아직 없으면(404) 자리 표시만 보인다
    else if (e.type === 'image') body = rect('#ebecf0', '#c1c7d0') + label(e, e.filename)
      + (opts.contentId && e.imageName ? `<image href="/api/att/${encodeURIComponent(opts.contentId)}/${encodeURIComponent(e.imageName)}" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" preserveAspectRatio="xMidYMid meet"/>` : '');
    else if (e.type === 'stamp') body = `<text x="${n(x + w / 2)}" y="${n(y + h / 2)}" dominant-baseline="central" text-anchor="middle" font-size="${Math.min(w, h)}">${esc(STAMPS[e.stamp] ?? '●')}</text>`;
    // 댓글 표시: 눌러서 본문 보기(WhiteboardView가 data-wb-comment로 찾는다). 이관된 댓글 수를 작은 숫자로
    else if (e.type === 'comment') {
      const count = opts.comments?.[e.commentId] ?? 0;
      body = `<g data-wb-comment="${esc(e.commentId ?? '')}" style="cursor:pointer"><title>${count ? `댓글 ${count}개 — 눌러서 보기` : '댓글'}</title><circle cx="${n(x + 12)}" cy="${n(y + 12)}" r="12" fill="#deebff" stroke="#0c66e4" stroke-width="${count ? 1 : 0}"/><text x="${n(x + 12)}" y="${n(y + 17)}" text-anchor="middle" font-size="14">💬</text>${count > 1 ? `<circle cx="${n(x + 23)}" cy="${n(y + 2)}" r="7" fill="#0c66e4"/><text x="${n(x + 23)}" y="${n(y + 6)}" text-anchor="middle" font-size="10" font-family="sans-serif" fill="#fff">${count}</text>` : ''}</g>`;
    }
    else if (e.type === 'drawing') body = `<polyline points="${(e.points ?? []).map(p => p.map(n).join(',')).join(' ')}" fill="none" stroke="${esc(e.color)}" stroke-width="2"/>`;
    else if (e.type === 'shape' || e.type === 'sticky') {
      if (e.shape === 2) body = `<ellipse cx="${n(x + w / 2)}" cy="${n(y + h / 2)}" rx="${n(w / 2)}" ry="${n(h / 2)}" fill="${esc(e.color)}" stroke="${esc(e.strokeColor)}"/>`;
      else if (e.shape === 4) body = `<polygon points="${n(x + w / 2)},${n(y)} ${n(x + w)},${n(y + h / 2)} ${n(x + w / 2)},${n(y + h)} ${n(x)},${n(y + h / 2)}" fill="${esc(e.color)}" stroke="${esc(e.strokeColor)}"/>`;
      else body = rect(e.color);
      body += label(e);
    }
    // 아직 모르는 요소(스마트 카드 등): 사라지지 않게 점선 상자와 종류를 표시한다
    else if (!['pathLabel', 'pathWaypoint'].includes(e.type)) body = rect('#f7f8f9', '#8590a2').replace('/>', ' stroke-dasharray="4 3"/>') + label({ ...e, type: 'unknown' }, e.text || `(${e.type} — 옮기지 못한 요소)`);
    parts.push(`<g transform="rotate(${n(e.rotation)} ${n(x + w / 2)} ${n(y + h / 2)})">${body}</g>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.join(' ')}" width="100%" height="100%" role="img" aria-label="화이트보드"><defs><marker id="wb-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10Z" fill="context-stroke"/></marker><marker id="wb-arrow-start" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M10 0 L0 5 L10 10Z" fill="context-stroke"/></marker></defs>${parts.join('')}</svg>`;
}
