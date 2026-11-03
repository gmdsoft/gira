export async function api(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

// 본문 doc 전처리: 첨부 이미지/파일 링크에 실제 URL을 채운다
export function hydrateDoc(doc, pageId) {
  if (!doc) return doc;
  const walk = (n) => {
    if (n.type === 'media' && n.attrs?.kind === 'attachment' && n.attrs.filename && !n.attrs.src) {
      n.attrs.src = `/api/att/${pageId}/${encodeURIComponent(n.attrs.filename)}`;
    }
    if (n.type === 'fileLink' && n.attrs?.filename && !n.attrs.href) {
      n.attrs.href = `/api/att/${pageId}/${encodeURIComponent(n.attrs.filename)}`;
    }
    if (n.type === 'table') hydrateTableColwidths(n);
    for (const c of n.content ?? []) walk(c);
  };
  walk(doc);
  return doc;
}

// 레거시 표(표 수준 colwidths)를 셀 colwidth(px)로 채워 편집기에서 폭 유지 + 열 리사이즈가 되게 한다.
// px는 그대로, %는 tableWidth(없으면 760) 기준 px로 환산. 이미 셀 colwidth가 있으면 건드리지 않는다.
function hydrateTableColwidths(table) {
  const cw = table.attrs?.colwidths;
  if (!cw || !cw.length) return;
  const base = (typeof table.attrs.tableWidth === 'number' && table.attrs.tableWidth) || 760;
  const px = cw.map((w) => {
    if (typeof w !== 'string') return null;
    if (w.endsWith('px')) return parseInt(w, 10) || null;
    if (w.endsWith('%')) return Math.round((parseFloat(w) / 100) * base) || null;
    return null;
  });
  if (!px.some((v) => v)) return;
  for (const row of table.content ?? []) {
    if (row.type !== 'tableRow') continue;
    let col = 0;
    for (const cell of row.content ?? []) {
      const span = cell.attrs?.colspan || 1;
      if (cell.attrs?.colwidth && cell.attrs.colwidth.some((v) => v)) { col += span; continue; }
      const widths = [];
      for (let j = 0; j < span; j += 1) widths.push(px[col + j] || 0);
      cell.attrs = { ...(cell.attrs || {}), colwidth: widths.some((v) => v) ? widths : null };
      col += span;
    }
  }
}
