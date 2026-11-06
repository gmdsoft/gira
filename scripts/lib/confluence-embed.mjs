// 원본 Confluence '스마트 링크 임베드'(type embed) → Gonfluence 문서 본문 (GIRA-59)
// REST v2 GET /wiki/api/v2/embeds/<id> 의 embedUrl 을 HTML 블록(iframe, GIRA-49)으로 보여 준다.
// - Figma 일반 주소는 Figma 임베드 주소로 바꾼다(그대로는 iframe에 안 뜸).
// - Confluence 문서 주소는 iframe 대신 Gonfluence로 여는 링크(이관돼 있으면 리디렉트).
// - 그 밖의 주소는 iframe + '새 탭에서 열기'. 사이트가 iframe을 막으면 링크로 열면 된다.

export function figmaEmbedUrl(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)figma\.com$/.test(u.hostname) || u.pathname.startsWith('/embed')) return null;
    return `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(url)}`;
  } catch { return null; }
}

export function confluencePageId(url) {
  try {
    const u = new URL(url);
    if (!/\.atlassian\.net$/.test(u.hostname)) return null;
    return u.pathname.match(/\/pages\/(?:edit-v2\/)?(\d+)/)?.[1] ?? u.searchParams.get('pageId');
  } catch { return null; }
}

const text = (t, href) => ({ type: 'text', text: t, ...(href ? { marks: [{ type: 'link', attrs: { href, target: '_blank' } }] } : {}) });

export function embedDoc(embedUrl) {
  if (!embedUrl) return { type: 'doc', content: [{ type: 'paragraph', content: [text('원본 임베드에 주소가 없습니다.')] }] };
  const pageId = confluencePageId(embedUrl);
  if (pageId) {
    return { type: 'doc', content: [{ type: 'paragraph', content: [text('Confluence 문서 임베드: '), text('Gonfluence에서 열기', `/wiki/pages/viewpage.action?pageId=${pageId}`), text(' · '), text('원본', embedUrl)] }] };
  }
  const src = figmaEmbedUrl(embedUrl) ?? embedUrl;
  return { type: 'doc', content: [
    { type: 'htmlEmbed', attrs: { source: 'iframe', src, height: 720, width: null, html: null } },
    { type: 'paragraph', content: [text('새 탭에서 열기', embedUrl)] },
  ] };
}
