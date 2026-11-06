// URL 임베드는 공개 DNS 호스트만 허용한다. HTML 본문은 별도의 opaque sandbox 사용.
export function safeEmbedUrl(value, origin = globalThis.location?.origin) {
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null;
    if (!host.includes('.') || /[:\[\]]/.test(host) || /^[\d.]+$/.test(host)
      || /\.(localhost|local|internal|lan|test|invalid)$/.test(host)) return null;
    if (origin && u.hostname === new URL(origin).hostname) return null;
    return u.href;
  } catch { return null; }
}

export function embedHeight(value) {
  const match = /^(\d+(?:\.\d+)?)(?:px)?$/.exec(String(value ?? '').trim());
  return match && Number(match[1]) > 0 ? Number(match[1]) : 400;
}

// connect/formを閉じることで、opaque originでも送信自体が可能なAPI要求を止める。
export function isolatedHtml(html) {
  // doctype보다 먼저 meta를 넣으면 표준 문서도 quirks mode로 바뀐다.
  const source = String(html ?? '');
  const doctype = /^\s*<!doctype[^>]*>/i.exec(source)?.[0] ?? '';
  return `${doctype}<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src https: 'unsafe-inline' 'unsafe-eval'; style-src https: 'unsafe-inline'; img-src https: data:; font-src https: data:; media-src https: data:; frame-src https: http:; connect-src 'none'; form-action 'none'; base-uri 'none'">${source.slice(doctype.length)}`;
}
