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
    for (const c of n.content ?? []) walk(c);
  };
  walk(doc);
  return doc;
}
