import { sourceLink } from './adf-source-links.mjs';
// 원본 URL을 보존하고, Gonfluence의 pageId 리디렉트를 사용한다.
export function confluencePageId(url) {
  try {
    const u = new URL(url);
    const id = sourceLink(url)?.id ?? u.searchParams.get('pageId');
    return /^\d+$/.test(id ?? '') ? id : null;
  } catch { return null; }
}

export function remoteLinkView(row, base) {
  const page = sourceLink(row.url);
  const id = row.app_type === 'com.atlassian.confluence' ? confluencePageId(row.url) : null;
  const path = page?.kind === 'page' ? page.path : id ? `/wiki/pages/viewpage.action?pageId=${id}` : null;
  return { ...row, open_url: path && base
    ? `${base.replace(/\/$/, '')}${path}` : row.url };
}
