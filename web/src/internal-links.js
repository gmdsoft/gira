// 이 인스턴스의 문서/Gira 주소만 인식한다. 외부 호스트는 조회하지 않는다.
export function internalLink(text, base) {
  try {
    const url = new URL(text, base);
    const local = new URL(base);
    if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== local.hostname || url.username || url.password) return null;
    const page = url.pathname.match(/^\/s\/[^/]+\/p\/(\d+)\/?$/)
      || url.pathname.match(/^\/wiki\/spaces\/[^/]+\/pages\/(\d+)(?:\/[^/]*)?\/?$/);
    if (page && url.origin === local.origin) return { kind: 'page', id: page[1], href: url.href };
    const issue = url.pathname.match(/^\/browse\/([A-Z][A-Z0-9_]*-\d+)\/?$/);
    if (issue && url.protocol === local.protocol && url.port === '3002') return { kind: 'issue', id: issue[1], href: url.href };
  } catch { /* URL 아님 */ }
  return null;
}
