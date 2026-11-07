import { sourceLink } from './adf-source-links.mjs';
import { decodeTinyToken } from './tinylink.mjs';

// 제목 조회도 Gonfluence의 사용자 권한 검사를 거친다. 원본으로 리디렉트하지 않는다.
export async function adfPageLink(raw, { publicBase, internalBase, headers = {}, fetchImpl = fetch }) {
  const link = sourceLink(raw);
  if (link?.kind !== 'page') return null;
  const href = `${publicBase.replace(/\/$/, '')}${link.path}`;
  const id = link.id ?? decodeTinyToken(link.path.split('/').pop());
  let title;
  if (id) {
    try {
      const res = await fetchImpl(`${internalBase.replace(/\/$/, '')}/api/content/${encodeURIComponent(id)}`, {
        headers, redirect: 'error', signal: AbortSignal.timeout(5000),
      });
      if (res.ok) title = (await res.json()).title;
    } catch { /* 미이관·권한 없음·연결 실패 시 주소로 표시 */ }
  }
  return { href, ...(title ? { title } : {}) };
}
