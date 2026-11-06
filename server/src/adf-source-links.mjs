// 원본 주소만 해석한다. ADF의 attrs.url은 변경하지 않는다.
export function sourceLink(raw) {
  try {
    const u = new URL(raw);
    if (u.origin !== 'https://gmdsoft.atlassian.net') return null;
    const key = u.searchParams.get('selectedIssue') ?? u.pathname.match(/\/(?:browse|issues)\/([A-Z][A-Z0-9_]*-[1-9]\d*)(?:\/|$)/)?.[1];
    if (key && /^[A-Z][A-Z0-9_]*-[1-9]\d*$/.test(key)) return { kind: 'issue', key, href: `/browse/${key}` };
    const id = u.searchParams.get('pageId') ?? u.pathname.match(/^\/wiki\/spaces\/[^/]+\/(?:pages(?:\/edit-v2)?|whiteboard|database|embed|folder)\/(\d+)(?:\/|$)/)?.[1];
    if (/^\d+$/.test(id ?? '')) return { kind: 'page', id, path: `/wiki/pages/viewpage.action?pageId=${id}` };
    if (/^\/wiki\/x\/[A-Za-z0-9_-]+$/.test(u.pathname)) return { kind: 'page', path: u.pathname };
  } catch { /* 잘못된 주소 */ }
  return null;
}
