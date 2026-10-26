// Confluence 단축 링크 /wiki/x/{token} 인코딩.
// token = 콘텐츠 ID(uint32)의 4바이트 리틀엔디언 base64, '/'→'-', '+'→'_', 끝의 '='와 'A' 제거.
// 2026-10-24 실측 검증: 3QCnAQ ↔ 27721949.

export function decodeTinyToken(token) {
  const b64 = token.replaceAll('-', '/').replaceAll('_', '+').padEnd(6, 'A');
  if (!/^[A-Za-z0-9+/]{6}$/.test(b64)) return null;
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < 4) return null;
  return buf.readUInt32LE(0);
}

export function encodeTinyToken(id) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(Number(id));
  return buf
    .toString('base64')
    .replaceAll('/', '-')
    .replaceAll('+', '_')
    .replace(/=+$/, '')
    .replace(/A+$/, '');
}
