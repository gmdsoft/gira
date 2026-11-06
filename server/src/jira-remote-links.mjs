// 원본 URL을 보존하고, Gonfluence의 pageId 리디렉트를 사용한다.
export function confluencePageId(url) {
  try {
    const id = new URL(url).searchParams.get('pageId');
    return /^\d+$/.test(id ?? '') ? id : null;
  } catch { return null; }
}

export function remoteLinkView(row, base) {
  const id = row.app_type === 'com.atlassian.confluence' ? confluencePageId(row.url) : null;
  return { ...row, open_url: id && base
    ? `${base.replace(/\/$/, '')}/wiki/pages/viewpage.action?pageId=${id}` : row.url };
}
